import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import type { CreateDocumentBrandExtractionDto } from './dto/document-branding.dto.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import { startDerivedLogoGraceIfUnreferenced } from './document-branding-extraction-retention.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROVIDER,
  DisabledDocumentBrandingExtractionProvider,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const EXTRACTION_QUOTA_LIMIT = 10;
const EXTRACTION_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const IDEMPOTENCY_INDEX = 'document_brand_extractions_idempotency_key';
const ACTIVE_EXTRACTION_INDEX =
  'document_brand_extractions_one_active_per_entity';

@Injectable()
export class DocumentBrandingExtractionService {
  private readonly logger = new Logger(DocumentBrandingExtractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Optional()
    @Inject(DOCUMENT_BRAND_EXTRACTION_PROVIDER)
    private readonly provider: DocumentBrandingExtractionProvider = new DisabledDocumentBrandingExtractionProvider(),
    @Optional()
    private readonly tasks?: DocumentBrandingExtractionTaskService,
  ) {}

  async create(
    legalEntityId: string,
    dto: CreateDocumentBrandExtractionDto,
    idempotencyKey: string,
  ) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    this.validateIdempotencyKey(idempotencyKey);
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: legalEntityId, tenant_id: tenantId },
      select: { id: true, is_active: true },
    });
    if (!entity) throw new NotFoundException('Legal entity not found');
    if (!entity.is_active) {
      throw new UnprocessableEntityException({
        code: 'LEGAL_ENTITY_INACTIVE',
        message: 'Letterhead extraction is unavailable for an inactive entity.',
      });
    }

    const source = await this.prisma.documentBrandAsset.findFirst({
      where: {
        id: dto.sourceAssetId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        purpose: 'SOURCE',
      },
      select: { id: true, state: true, expires_at: true },
    });
    if (!source) throw new NotFoundException('Source asset not found');
    if (
      source.state !== 'READY' ||
      (source.expires_at !== null && source.expires_at <= new Date())
    ) {
      throw new UnprocessableEntityException({
        code: 'BRAND_ASSET_NOT_READY',
        message: 'The source asset is not ready for extraction.',
      });
    }

    if (!this.provider.isAvailable()) {
      throw new ServiceUnavailableException({
        code: 'BRAND_EXTRACTION_UNAVAILABLE',
        message: 'Letterhead extraction is not currently available.',
      });
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify(dto))
      .digest('hex');
    const createExtraction = this.prisma.$transaction(async (tx) => {
      const entityLock = await tx.legalEntity.updateMany({
        where: {
          id: legalEntityId,
          tenant_id: tenantId,
          is_active: true,
        },
        data: { is_active: true },
      });
      if (entityLock.count !== 1) {
        const currentEntity = await tx.legalEntity.findFirst({
          where: { id: legalEntityId, tenant_id: tenantId },
          select: { id: true },
        });
        if (currentEntity) {
          throw new UnprocessableEntityException({
            code: 'LEGAL_ENTITY_INACTIVE',
            message:
              'Letterhead extraction is unavailable for an inactive entity.',
          });
        }
        throw new NotFoundException('Legal entity not found');
      }

      const currentSource = await tx.documentBrandAsset.findFirst({
        where: {
          id: dto.sourceAssetId,
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          purpose: 'SOURCE',
        },
        select: { id: true, state: true, expires_at: true },
      });
      if (!currentSource) throw new NotFoundException('Source asset not found');
      if (
        currentSource.state !== 'READY' ||
        (currentSource.expires_at !== null &&
          currentSource.expires_at <= new Date())
      ) {
        throw new UnprocessableEntityException({
          code: 'BRAND_ASSET_NOT_READY',
          message: 'The source asset is not ready for extraction.',
        });
      }

      const existing = await tx.documentBrandExtraction.findFirst({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          idempotency_key: idempotencyKey,
        },
      });
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'BRAND_IDEMPOTENCY_CONFLICT',
            message:
              'The idempotency key was already used for another request.',
          });
        }
        return existing;
      }

      const currentProfile = await tx.documentBrandProfile.findFirst({
        where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
        select: { revision: true },
      });
      const currentRevision = currentProfile?.revision ?? 0;
      if (currentRevision !== dto.expectedRevision) {
        throw new ConflictException({
          code: 'BRAND_REVISION_CONFLICT',
          message: 'The branding profile changed before extraction started.',
        });
      }

      const activeJob = await tx.documentBrandExtraction.findFirst({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          state: { in: ['QUEUED', 'RUNNING'] },
        },
        select: { id: true },
      });
      if (activeJob) {
        throw new ConflictException({
          code: 'BRAND_EXTRACTION_BUSY',
          message: 'An extraction is already active for this legal entity.',
        });
      }

      await tx.documentBrandQuotaLock.upsert({
        where: {
          tenant_id_action_scope_key: {
            tenant_id: tenantId,
            action: 'EXTRACTION',
            scope_key: `entity:${legalEntityId}`,
          },
        },
        create: {
          tenant_id: tenantId,
          action: 'EXTRACTION',
          scope_key: `entity:${legalEntityId}`,
        },
        update: { updated_at: new Date() },
      });
      const hourAgo = new Date(Date.now() - EXTRACTION_QUOTA_WINDOW_MS);
      await tx.documentBrandQuotaEvent.deleteMany({
        where: { tenant_id: tenantId, created_at: { lt: hourAgo } },
      });
      const recentExtractions = await tx.documentBrandQuotaEvent.count({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          action: 'EXTRACTION',
          created_at: { gte: hourAgo },
        },
      });
      if (recentExtractions >= EXTRACTION_QUOTA_LIMIT) {
        throw new HttpException(
          {
            code: 'BRAND_EXTRACTION_QUOTA_EXCEEDED',
            message:
              'This legal entity has reached its letterhead extraction limit.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await tx.documentBrandQuotaEvent.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          user_id: user.id,
          action: 'EXTRACTION',
        },
      });
      return tx.documentBrandExtraction.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          source_asset_id: dto.sourceAssetId,
          requested_by_user_id: user.id,
          base_revision: dto.expectedRevision,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          prompt_version: 'document-branding-v1',
          dispatched_at: null,
          dispatch_count: 0,
        },
      });
    });

    let extraction: Awaited<typeof createExtraction>;
    try {
      extraction = await createExtraction;
    } catch (error) {
      const constraintIndex = this.getUniqueConstraintIndex(error);
      if (constraintIndex === IDEMPOTENCY_INDEX) {
        const existing = await this.prisma.documentBrandExtraction.findFirst({
          where: {
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            idempotency_key: idempotencyKey,
          },
        });
        if (!existing) throw error;
        if (existing.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'BRAND_IDEMPOTENCY_CONFLICT',
            message:
              'The idempotency key was already used for another request.',
          });
        }
        extraction = existing;
      } else if (constraintIndex === ACTIVE_EXTRACTION_INDEX) {
        throw new ConflictException({
          code: 'BRAND_EXTRACTION_BUSY',
          message: 'An extraction is already active for this legal entity.',
        });
      } else {
        throw error;
      }
    }

    if (extraction.state === 'QUEUED' && this.tasks) {
      await this.enqueue(
        extraction.id,
        legalEntityId,
        tenantId,
        extraction.attempt_count,
      );
    }
    return this.toResponse(extraction);
  }

  async get(legalEntityId: string, extractionId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);
    const extraction = await this.prisma.documentBrandExtraction.findFirst({
      where: {
        id: extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
      },
    });
    if (!extraction) throw new NotFoundException('Extraction not found');
    return this.toResponse(extraction);
  }

  async discard(legalEntityId: string, extractionId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);
    const extraction = await this.prisma.$transaction(async (tx) => {
      const entity = await tx.legalEntity.findFirst({
        where: { id: legalEntityId, tenant_id: tenantId },
        select: { id: true, is_active: true },
      });
      if (!entity) throw new NotFoundException('Legal entity not found');
      const entityLock = await tx.legalEntity.updateMany({
        where: {
          id: legalEntityId,
          tenant_id: tenantId,
          is_active: true,
        },
        data: { is_active: true },
      });
      if (entityLock.count !== 1) {
        throw new UnprocessableEntityException({
          code: 'LEGAL_ENTITY_INACTIVE',
          message: 'Document branding is unavailable for an inactive entity.',
        });
      }
      const current = await tx.documentBrandExtraction.findFirst({
        where: {
          id: extractionId,
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
        },
      });
      if (!current) throw new NotFoundException('Extraction not found');
      if (current.state === 'DISCARDED') return current;
      const changed = await tx.documentBrandExtraction.updateMany({
        where: {
          id: extractionId,
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          state: current.state,
        },
        data: {
          state: 'DISCARDED',
          proposal: Prisma.DbNull,
          proposal_logo_asset_id: null,
          failure_code: null,
          lease_token: null,
          lease_until: null,
          completed_at: new Date(),
          expires_at: new Date(),
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException({
          code: 'BRAND_EXTRACTION_CHANGED',
          message: 'The extraction changed while it was being discarded.',
        });
      }
      if (current.proposal_logo_asset_id) {
        await startDerivedLogoGraceIfUnreferenced(tx, {
          tenantId,
          legalEntityId,
          assetId: current.proposal_logo_asset_id,
          now: new Date(),
        });
      }
      return tx.documentBrandExtraction.findFirstOrThrow({
        where: {
          id: extractionId,
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
        },
      });
    });
    return this.toResponse(extraction);
  }

  private async enqueue(
    extractionId: string,
    legalEntityId: string,
    tenantId: string,
    expectedAttemptCount: number,
  ) {
    try {
      await this.tasks?.enqueue({
        extractionId,
        legalEntityId,
        tenantId,
        expectedAttemptCount,
      });
    } catch (error) {
      this.logger.warn(
        `Could not enqueue document branding extraction ${extractionId}: ${safeError(error)}`,
      );
    }
  }

  private toResponse(extraction: {
    id: string;
    state: string;
    proposal: Prisma.JsonValue | null;
    warning_codes: string[];
    base_revision: number;
    createdAt: Date;
    completed_at: Date | null;
    expires_at: Date | null;
    failure_code: string | null;
  }) {
    return {
      id: extraction.id,
      state: extraction.state,
      proposal:
        extraction.state === 'SUCCEEDED' &&
        extraction.expires_at !== null &&
        extraction.expires_at > new Date()
          ? (extraction.proposal as Record<string, unknown> | null)
          : null,
      warnings: extraction.warning_codes,
      baseRevision: extraction.base_revision,
      createdAt: extraction.createdAt,
      completedAt: extraction.completed_at,
      expiresAt: extraction.expires_at,
      failureCode: extraction.failure_code,
    };
  }

  private validateIdempotencyKey(value: string) {
    if (
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
      !/^[\x21-\x7e]+$/.test(value)
    ) {
      throw new UnprocessableEntityException({
        code: 'BRAND_IDEMPOTENCY_KEY_INVALID',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
  }

  private getUniqueConstraintIndex(error: unknown): string | null {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return null;
    }
    const meta = error.meta as
      | {
          driverAdapterError?: {
            cause?: { constraint?: { index?: unknown } };
          };
        }
      | undefined;
    const index = meta?.driverAdapterError?.cause?.constraint?.index;
    return typeof index === 'string' ? index : null;
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
