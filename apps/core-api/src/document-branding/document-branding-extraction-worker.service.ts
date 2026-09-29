import {
  HttpException,
  Injectable,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROVIDER,
  DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
  DisabledDocumentBrandingExtractionProvider,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import { parseDocumentBrandingExtractionResponse } from './document-branding-extraction-response.js';

const EXTRACTION_LEASE_MS = 120 * 1000;
const MAX_WORKER_ATTEMPT_MS = 60 * 1000;
const IMAGE_PROCESS_LIMIT_MS = 15 * 1000;
const PROPOSAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSIENT_RETRY_DELAYS_SECONDS = [5, 20];

@Injectable()
export class DocumentBrandingExtractionWorkerService {
  private readonly logger = new Logger(
    DocumentBrandingExtractionWorkerService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly pdfParser: DocumentBrandingPdfParser,
    private readonly imageProcessor: DocumentBrandingExtractionImageProcessor,
    @Optional()
    @Inject(DOCUMENT_BRAND_EXTRACTION_PROVIDER)
    private readonly provider: DocumentBrandingExtractionProvider = new DisabledDocumentBrandingExtractionProvider(),
    @Optional()
    private readonly tasks?: DocumentBrandingExtractionTaskService,
  ) {}

  async process(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    expectedAttemptCount: number,
  ): Promise<void> {
    const claimed = await this.claim(
      extractionId,
      legalEntityId,
      tenantId,
      expectedAttemptCount,
    );
    if (!claimed) return;
    const attemptStartedAt = Date.now();
    let publishedObject: {
      bucket: string;
      key: string;
      generation: string;
    } | null = null;

    try {
      const extraction = await this.readClaimedExtraction(
        extractionId,
        legalEntityId,
        tenantId,
        claimed.leaseToken,
      );
      if (!extraction) return;
      const source = await this.readAuthorizedSource(extraction, tenantId);
      const sourceBytes = await this.storage.readGeneration(
        source.bucket!,
        source.object_key!,
        source.object_generation!,
      );
      const raster = await this.rasterizeSource(
        source.detected_mime_type,
        sourceBytes,
      );
      this.assertAttemptDeadline(attemptStartedAt);
      const providerTimeoutMs = Math.min(
        30_000,
        MAX_WORKER_ATTEMPT_MS -
          (Date.now() - attemptStartedAt) -
          IMAGE_PROCESS_LIMIT_MS,
      );
      if (providerTimeoutMs <= 0) {
        throw new ExtractionFailure('BRAND_EXTRACTION_ATTEMPT_TIMEOUT');
      }
      const providerResult = await this.provider.extract({
        normalizedFirstPagePng: raster.bytes,
        promptVersion: DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
        signal: AbortSignal.timeout(providerTimeoutMs),
      });
      const proposal = parseDocumentBrandingExtractionResponse(providerResult);
      this.assertAttemptDeadline(attemptStartedAt);
      const logo = await this.imageProcessor.cropLogo(
        raster.bytes,
        proposal.cropRect,
      );
      this.assertAttemptDeadline(attemptStartedAt);
      const logoAssetId = randomUUID();
      const objectKey = `tenants/${tenantId}/legal-entities/${legalEntityId}/document-branding/assets/${logoAssetId}.png`;
      const stored = await this.storage.storeImmutable({
        objectKey,
        bytes: logo.bytes,
        contentType: 'image/png',
      });
      publishedObject = {
        bucket: stored.bucket,
        key: objectKey,
        generation: stored.generation,
      };
      const published = await this.publishProposal({
        extraction,
        tenantId,
        legalEntityId,
        leaseToken: claimed.leaseToken,
        logoAssetId,
        logo,
        object: publishedObject,
        proposal,
        extraWarningCodes: raster.warningCodes,
      });
      if (published) publishedObject = null;
    } catch (error) {
      await this.failOrRetry({
        extractionId,
        legalEntityId,
        tenantId,
        leaseToken: claimed.leaseToken,
        attemptCount: claimed.attemptCount,
        error,
      });
    } finally {
      if (publishedObject) {
        await this.storage
          .deleteGeneration(
            publishedObject.bucket,
            publishedObject.key,
            publishedObject.generation,
          )
          .catch((error: unknown) => {
            this.logger.warn(
              `Could not remove unpublished extraction logo: ${safeError(error)}`,
            );
          });
      }
    }
  }

  private async claim(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    expectedAttemptCount: number,
  ) {
    const now = new Date();
    const leaseToken = randomUUID();
    const result = await this.prisma.documentBrandExtraction.updateMany({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'QUEUED',
        attempt_count: expectedAttemptCount,
      },
      data: {
        state: 'RUNNING',
        attempt_count: { increment: 1 },
        lease_token: leaseToken,
        lease_until: new Date(now.getTime() + EXTRACTION_LEASE_MS),
      },
    });
    if (result.count !== 1) return null;
    const extraction = await this.prisma.documentBrandExtraction.findFirst({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'RUNNING',
        lease_token: leaseToken,
      },
      select: { attempt_count: true },
    });
    return extraction
      ? { leaseToken, attemptCount: extraction.attempt_count }
      : null;
  }

  private readClaimedExtraction(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    leaseToken: string,
  ) {
    return this.prisma.documentBrandExtraction.findFirst({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'RUNNING',
        lease_token: leaseToken,
      },
    });
  }

  private async readAuthorizedSource(
    extraction: NonNullable<
      Awaited<
        ReturnType<
          DocumentBrandingExtractionWorkerService['readClaimedExtraction']
        >
      >
    >,
    tenantId: string,
  ) {
    if (!extraction.source_asset_id) {
      throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
    }
    if (!extraction.requested_by_user_id) {
      throw new ExtractionFailure('BRAND_REQUESTER_UNAVAILABLE');
    }
    const [membership, entity, source] = await Promise.all([
      this.prisma.tenantMember.findFirst({
        where: {
          tenant_id: tenantId,
          user_id: extraction.requested_by_user_id,
          is_active: true,
          role: { in: ['OWNER', 'ADMIN'] },
        },
        select: { id: true },
      }),
      this.prisma.legalEntity.findFirst({
        where: {
          id: extraction.legal_entity_id,
          tenant_id: tenantId,
          is_active: true,
        },
        select: { id: true },
      }),
      this.prisma.documentBrandAsset.findFirst({
        where: {
          id: extraction.source_asset_id,
          tenant_id: tenantId,
          legal_entity_id: extraction.legal_entity_id,
          purpose: 'SOURCE',
          state: 'READY',
          expires_at: { gt: new Date() },
        },
      }),
    ]);
    if (!membership) throw new ExtractionFailure('BRAND_REQUESTER_REVOKED');
    if (!entity) throw new ExtractionFailure('LEGAL_ENTITY_INACTIVE');
    if (
      !source ||
      !source.bucket ||
      !source.object_key ||
      !source.object_generation
    ) {
      throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
    }
    return source;
  }

  private async rasterizeSource(mimeType: string | null, sourceBytes: Buffer) {
    if (mimeType === 'application/pdf') {
      const pdf = await this.pdfParser.validateAndRasterize(sourceBytes);
      const raster = await this.imageProcessor.normalizePng(pdf.raster);
      return {
        ...raster,
        warningCodes: pdf.warning ? [pdf.warning] : [],
      };
    }
    const raster = await this.imageProcessor.normalizePng(sourceBytes);
    return { ...raster, warningCodes: [] as string[] };
  }

  private async publishProposal(params: {
    extraction: NonNullable<
      Awaited<
        ReturnType<
          DocumentBrandingExtractionWorkerService['readClaimedExtraction']
        >
      >
    >;
    tenantId: string;
    legalEntityId: string;
    leaseToken: string;
    logoAssetId: string;
    logo: { bytes: Buffer; width: number; height: number };
    object: { bucket: string; key: string; generation: string };
    proposal: ReturnType<typeof parseDocumentBrandingExtractionResponse>;
    extraWarningCodes: string[];
  }): Promise<boolean> {
    const now = new Date();
    const warningCodes = [
      ...new Set([
        ...params.proposal.warningCodes,
        ...params.extraWarningCodes,
      ]),
    ];
    const theme = { ...params.proposal.theme, logoAssetId: params.logoAssetId };
    const providerMetadata = this.provider.getMetadata();
    return this.prisma.$transaction(async (tx) => {
      const entity = await tx.legalEntity.findFirst({
        where: {
          id: params.legalEntityId,
          tenant_id: params.tenantId,
          is_active: true,
        },
        select: { id: true },
      });
      if (!entity) throw new ExtractionFailure('LEGAL_ENTITY_INACTIVE');
      const entityLock = await tx.legalEntity.updateMany({
        where: {
          id: params.legalEntityId,
          tenant_id: params.tenantId,
          is_active: true,
        },
        data: { is_active: true },
      });
      if (entityLock.count !== 1) {
        throw new ExtractionFailure('LEGAL_ENTITY_INACTIVE');
      }
      if (!params.extraction.source_asset_id) {
        throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
      }
      const source = await tx.documentBrandAsset.findFirst({
        where: {
          id: params.extraction.source_asset_id,
          tenant_id: params.tenantId,
          legal_entity_id: params.legalEntityId,
          purpose: 'SOURCE',
          state: 'READY',
          expires_at: { gt: now },
        },
        select: { id: true },
      });
      if (!source) throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
      const stillRunning = await tx.documentBrandExtraction.updateMany({
        where: {
          id: params.extraction.id,
          tenant_id: params.tenantId,
          legal_entity_id: params.legalEntityId,
          state: 'RUNNING',
          lease_token: params.leaseToken,
        },
        data: { lease_until: new Date(now.getTime() + EXTRACTION_LEASE_MS) },
      });
      if (stillRunning.count !== 1) return false;
      await tx.documentBrandAsset.create({
        data: {
          id: params.logoAssetId,
          tenant_id: params.tenantId,
          legal_entity_id: params.legalEntityId,
          purpose: 'LOGO',
          state: 'READY',
          bucket: params.object.bucket,
          object_key: params.object.key,
          object_generation: params.object.generation,
          sha256: createHash('sha256').update(params.logo.bytes).digest('hex'),
          byte_length: params.logo.bytes.byteLength,
          detected_mime_type: 'image/png',
          pixel_width: params.logo.width,
          pixel_height: params.logo.height,
          expires_at: null,
        },
      });
      const completed = await tx.documentBrandExtraction.updateMany({
        where: {
          id: params.extraction.id,
          tenant_id: params.tenantId,
          legal_entity_id: params.legalEntityId,
          state: 'RUNNING',
          lease_token: params.leaseToken,
        },
        data: {
          state: 'SUCCEEDED',
          proposal: theme,
          proposal_logo_asset_id: params.logoAssetId,
          warning_codes: warningCodes,
          prompt_version: DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
          provider_id: providerMetadata.providerId,
          model_id: providerMetadata.modelId,
          failure_code: null,
          lease_token: null,
          lease_until: null,
          completed_at: now,
          expires_at: new Date(
            params.extraction.createdAt.getTime() + PROPOSAL_RETENTION_MS,
          ),
        },
      });
      if (completed.count !== 1) {
        throw new Error(
          'Extraction lease changed while publishing its proposal',
        );
      }
      return true;
    });
  }

  private async failOrRetry(params: {
    extractionId: string;
    legalEntityId: string;
    tenantId: string;
    leaseToken: string;
    attemptCount: number;
    error: unknown;
  }) {
    const transient = isTransientError(params.error);
    const retryDelay = TRANSIENT_RETRY_DELAYS_SECONDS[params.attemptCount - 1];
    const retry = transient && retryDelay !== undefined;
    const now = new Date();
    const updated = await this.prisma.documentBrandExtraction.updateMany({
      where: {
        id: params.extractionId,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        state: 'RUNNING',
        lease_token: params.leaseToken,
      },
      data: {
        state: retry ? 'QUEUED' : 'FAILED',
        failure_code: retry ? null : failureCode(params.error),
        lease_token: null,
        lease_until: null,
        dispatched_at: null,
        completed_at: retry ? null : now,
        expires_at: retry
          ? null
          : new Date(now.getTime() + PROPOSAL_RETENTION_MS),
      },
    });
    if (updated.count !== 1) return;
    if (retry) {
      await this.tasks
        ?.enqueue({
          extractionId: params.extractionId,
          legalEntityId: params.legalEntityId,
          tenantId: params.tenantId,
          expectedAttemptCount: params.attemptCount,
          delaySeconds: retryDelay,
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not retry document branding extraction ${params.extractionId}: ${safeError(error)}`,
          );
        });
    }
  }

  private assertAttemptDeadline(startedAt: number): void {
    if (Date.now() - startedAt > MAX_WORKER_ATTEMPT_MS) {
      throw new ExtractionFailure('BRAND_EXTRACTION_ATTEMPT_TIMEOUT');
    }
  }
}

class ExtractionFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isTransientError(error: unknown): boolean {
  if (error instanceof ExtractionFailure) {
    return error.code === 'BRAND_EXTRACTION_ATTEMPT_TIMEOUT';
  }
  return !(error instanceof HttpException) || error.getStatus() >= 500;
}

function failureCode(error: unknown): string {
  if (error instanceof ExtractionFailure) return error.code;
  if (error instanceof HttpException && error.getStatus() < 500) {
    const response = error.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      typeof response.code === 'string' &&
      /^BRAND_[A-Z0-9_]{1,60}$/.test(response.code)
    ) {
      return response.code;
    }
  }
  return 'BRAND_EXTRACTION_FAILED';
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
