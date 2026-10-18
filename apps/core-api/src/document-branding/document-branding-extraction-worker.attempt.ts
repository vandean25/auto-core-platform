import { randomUUID } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SpanHandle } from '../common/observability/trace.js';
import {
  toByteSizeBucket,
  withStatusSpan,
} from '../common/observability/trace.js';
import type { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import type { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import type { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import type { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import { parseDocumentBrandingExtractionResponse } from './document-branding-extraction-response.js';
import {
  ExtractionFailure,
  extractionFailureCode,
  retryDelaySeconds,
  safeExtractionWorkerError,
} from './document-branding-extraction-worker.errors.js';
import { publishExtractionProposal } from './document-branding-extraction-worker.publish.js';
import { readAuthorizedExtractionSource } from './document-branding-extraction-worker.source.js';

const MAX_WORKER_ATTEMPT_MS = 60 * 1000;
const IMAGE_PROCESS_LIMIT_MS = 15 * 1000;
const PROPOSAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function runExtractionWorkerAttempt(params: {
  extractionId: string;
  legalEntityId: string;
  tenantId: string;
  claimed: { leaseToken: string; attemptCount: number };
  span: SpanHandle;
  prisma: PrismaService;
  storage: DocumentBrandingAssetStorage;
  pdfParser: DocumentBrandingPdfParser;
  imageProcessor: DocumentBrandingExtractionImageProcessor;
  provider: DocumentBrandingExtractionProvider;
  tasks?: DocumentBrandingExtractionTaskService;
  logger: Logger;
  readClaimedExtraction: (
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    leaseToken: string,
  ) => Promise<{
    id: string;
    tenant_id: string;
    legal_entity_id: string;
    source_asset_id: string | null;
    requested_by_user_id: string | null;
    createdAt: Date;
  } | null>;
}): Promise<void> {
  const attemptStartedAt = Date.now();
  let publishedObject: {
    bucket: string;
    key: string;
    generation: string;
  } | null = null;

  try {
    const extraction = await params.readClaimedExtraction(
      params.extractionId,
      params.legalEntityId,
      params.tenantId,
      params.claimed.leaseToken,
    );
    if (!extraction) {
      params.span.setAttribute('status', 'skipped');
      return;
    }
    params.span.setAttribute('asset_id', extraction.source_asset_id);
    const source = await readAuthorizedExtractionSource(
      params.prisma,
      extraction,
      params.tenantId,
    );
    const sourceBytes = await params.storage.readGeneration(
      source.bucket!,
      source.object_key!,
      source.object_generation!,
    );
    params.span.setAttribute(
      'byte_size_bucket',
      toByteSizeBucket(sourceBytes.byteLength),
    );
    const raster = await rasterizeExtractionSource(
      params.pdfParser,
      params.imageProcessor,
      source.detected_mime_type,
      sourceBytes,
    );
    assertExtractionAttemptDeadline(attemptStartedAt);
    const providerTimeoutMs = Math.min(
      30_000,
      MAX_WORKER_ATTEMPT_MS -
        (Date.now() - attemptStartedAt) -
        IMAGE_PROCESS_LIMIT_MS,
    );
    if (providerTimeoutMs <= 0) {
      throw new ExtractionFailure('BRAND_EXTRACTION_ATTEMPT_TIMEOUT');
    }
    const providerResult = await extractWithBrandingProvider(
      params.provider,
      raster.bytes,
      providerTimeoutMs,
    );
    const proposal = parseDocumentBrandingExtractionResponse(providerResult);
    assertExtractionAttemptDeadline(attemptStartedAt);
    const logo = await params.imageProcessor.cropLogo(
      raster.bytes,
      proposal.cropRect,
    );
    assertExtractionAttemptDeadline(attemptStartedAt);
    const logoAssetId = randomUUID();
    const objectKey = `tenants/${params.tenantId}/legal-entities/${params.legalEntityId}/document-branding/assets/${logoAssetId}.png`;
    const stored = await params.storage.storeImmutable({
      objectKey,
      bytes: logo.bytes,
      contentType: 'image/png',
    });
    publishedObject = {
      bucket: stored.bucket,
      key: objectKey,
      generation: stored.generation,
    };
    const published = await publishExtractionProposal({
      prisma: params.prisma,
      provider: params.provider,
      extraction,
      tenantId: params.tenantId,
      legalEntityId: params.legalEntityId,
      leaseToken: params.claimed.leaseToken,
      logoAssetId,
      logo,
      object: publishedObject,
      proposal,
      extraWarningCodes: raster.warningCodes,
    });
    if (published) publishedObject = null;
    params.span.setAttribute(
      'status',
      published ? 'published' : 'not_published',
    );
  } catch (error) {
    params.span.setAttributes({
      status:
        retryDelaySeconds(error, params.claimed.attemptCount) !== undefined
          ? 'retry'
          : 'failed',
      failure_code: extractionFailureCode(error),
    });
    await failOrRetryExtractionAttempt({
      prisma: params.prisma,
      tasks: params.tasks,
      logger: params.logger,
      extractionId: params.extractionId,
      legalEntityId: params.legalEntityId,
      tenantId: params.tenantId,
      leaseToken: params.claimed.leaseToken,
      attemptCount: params.claimed.attemptCount,
      error,
    });
  } finally {
    params.span.setAttribute('duration_ms', Date.now() - attemptStartedAt);
    if (publishedObject) {
      await params.storage
        .deleteGeneration(
          publishedObject.bucket,
          publishedObject.key,
          publishedObject.generation,
        )
        .catch((cleanupError: unknown) => {
          params.logger.warn(
            `Could not remove unpublished extraction logo: ${safeExtractionWorkerError(cleanupError)}`,
          );
        });
    }
  }
}

async function rasterizeExtractionSource(
  pdfParser: DocumentBrandingPdfParser,
  imageProcessor: DocumentBrandingExtractionImageProcessor,
  mimeType: string | null,
  sourceBytes: Buffer,
) {
  return withStatusSpan(
    'Parse document branding source',
    'branding.extract.parse',
    {
      source_kind: mimeType === 'application/pdf' ? 'pdf' : 'image',
      byte_size_bucket: toByteSizeBucket(sourceBytes.byteLength),
    },
    async () => {
      if (mimeType === 'application/pdf') {
        const pdf = await pdfParser.validateAndRasterize(sourceBytes);
        const raster = await imageProcessor.normalizePng(pdf.raster);
        return {
          ...raster,
          warningCodes: pdf.warning ? [pdf.warning] : [],
        };
      }
      const raster = await imageProcessor.normalizePng(sourceBytes);
      return { ...raster, warningCodes: [] as string[] };
    },
  );
}

function extractWithBrandingProvider(
  provider: DocumentBrandingExtractionProvider,
  normalizedFirstPagePng: Buffer,
  timeoutMs: number,
): Promise<unknown> {
  const { providerId, modelId } = provider.getMetadata();
  return withStatusSpan(
    'Extract branding with provider',
    'branding.extract.provider',
    { provider: providerId, model_id: modelId },
    () =>
      provider.extract({
        normalizedFirstPagePng,
        promptVersion: DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION,
        signal: AbortSignal.timeout(timeoutMs),
      }),
  );
}

function assertExtractionAttemptDeadline(startedAt: number): void {
  if (Date.now() - startedAt > MAX_WORKER_ATTEMPT_MS) {
    throw new ExtractionFailure('BRAND_EXTRACTION_ATTEMPT_TIMEOUT');
  }
}

async function failOrRetryExtractionAttempt(params: {
  prisma: PrismaService;
  tasks?: DocumentBrandingExtractionTaskService;
  logger: Logger;
  extractionId: string;
  legalEntityId: string;
  tenantId: string;
  leaseToken: string;
  attemptCount: number;
  error: unknown;
}) {
  const retryDelay = retryDelaySeconds(params.error, params.attemptCount);
  const retry = retryDelay !== undefined;
  const now = new Date();
  const updated = await params.prisma.documentBrandExtraction.updateMany({
    where: {
      id: params.extractionId,
      tenant_id: params.tenantId,
      legal_entity_id: params.legalEntityId,
      state: 'RUNNING',
      lease_token: params.leaseToken,
    },
    data: {
      state: retry ? 'QUEUED' : 'FAILED',
      failure_code: retry ? null : extractionFailureCode(params.error),
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
    await params.tasks
      ?.enqueue({
        extractionId: params.extractionId,
        legalEntityId: params.legalEntityId,
        tenantId: params.tenantId,
        expectedAttemptCount: params.attemptCount,
        delaySeconds: retryDelay,
      })
      .catch((enqueueError: unknown) => {
        params.logger.warn(
          `Could not retry document branding extraction ${params.extractionId}: ${safeExtractionWorkerError(enqueueError)}`,
        );
      });
  }
}
