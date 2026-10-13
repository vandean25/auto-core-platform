import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';
import {
  assertPurposeSupportsMime,
  detectMimeType,
  type DocumentBrandPurpose,
  mapDocumentBrandAssetResponse,
  requirePurpose,
  requireUpload,
  sanitizeFilename,
} from './document-branding-upload.rules.js';

const UPLOAD_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const UPLOAD_QUOTA_LIMIT = 20;
const QUARANTINE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Admits an upload: validates the file, reserves the per-entity quota, stores the
 * bytes in quarantine, persists the QUARANTINED row and dispatches validation.
 */
@Injectable()
export class DocumentBrandingUploadAdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly tasks: DocumentBrandingUploadTaskService,
    private readonly requestContext: RequestContextService,
  ) {}

  async admit(
    legalEntityId: string,
    purposeValue: string,
    file: Express.Multer.File | undefined,
  ) {
    const purpose = requirePurpose(purposeValue);
    const originalBytes = requireUpload(file, purpose);
    const detectedMimeType = detectMimeType(originalBytes);
    assertPurposeSupportsMime(purpose, detectedMimeType);

    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    await this.assertEntityAcceptsUploads(tenantId, legalEntityId);

    const assetId = randomUUID();
    const quarantineObjectKey = `tenants/${tenantId}/legal-entities/${legalEntityId}/document-branding/quarantine/${assetId}`;
    await this.reserveUploadQuota(tenantId, legalEntityId, currentUser.id);
    const quarantine = await this.storage.storeImmutable({
      objectKey: quarantineObjectKey,
      bytes: originalBytes,
      contentType: 'application/octet-stream',
    });
    const asset = await this.persistQuarantinedAsset(
      buildQuarantinedAssetRow({
        assetId,
        tenantId,
        legalEntityId,
        purpose,
        originalBytes,
        detectedMimeType,
        originalFilename: file?.originalname ?? '',
        quarantine,
        quarantineObjectKey,
      }),
    );
    await this.dispatchValidation(assetId, tenantId);
    return mapDocumentBrandAssetResponse(asset);
  }

  private async assertEntityAcceptsUploads(
    tenantId: string,
    legalEntityId: string,
  ) {
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: legalEntityId, tenant_id: tenantId },
      select: { id: true, is_active: true },
    });
    if (!entity) throw new NotFoundException('Legal entity not found');
    if (!entity.is_active) {
      throw new UnprocessableEntityException({
        code: 'LEGAL_ENTITY_INACTIVE',
        message:
          'Document branding assets cannot be uploaded for an inactive entity.',
      });
    }
  }

  private async reserveUploadQuota(
    tenantId: string,
    legalEntityId: string,
    userId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveLegalEntityForUpload(tx, tenantId, legalEntityId);
      const hourAgo = new Date(Date.now() - UPLOAD_QUOTA_WINDOW_MS);
      await tx.documentBrandQuotaLock.upsert({
        where: {
          tenant_id_action_scope_key: {
            tenant_id: tenantId,
            action: 'ASSET_UPLOAD',
            scope_key: `entity:${legalEntityId}`,
          },
        },
        create: {
          tenant_id: tenantId,
          action: 'ASSET_UPLOAD',
          scope_key: `entity:${legalEntityId}`,
        },
        update: { updated_at: new Date() },
      });
      await tx.documentBrandQuotaEvent.deleteMany({
        where: { tenant_id: tenantId, created_at: { lt: hourAgo } },
      });
      const recentUploads = await tx.documentBrandQuotaEvent.count({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          action: 'ASSET_UPLOAD',
          created_at: { gte: hourAgo },
        },
      });
      if (recentUploads >= UPLOAD_QUOTA_LIMIT) {
        throw new HttpException(
          {
            code: 'BRAND_UPLOAD_QUOTA_EXCEEDED',
            message:
              'This legal entity has reached its document branding upload limit.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await tx.documentBrandQuotaEvent.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          user_id: userId,
          action: 'ASSET_UPLOAD',
        },
      });
    });
  }

  /** Persists the row; a failed insert removes the quarantine copy before rethrowing. */
  private async persistQuarantinedAsset(row: QuarantinedAssetRow) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockActiveLegalEntityForUpload(
          tx,
          row.tenant_id,
          row.legal_entity_id,
        );
        return tx.documentBrandAsset.create({ data: row });
      });
    } catch (error) {
      await this.storage.deleteGeneration(
        row.quarantine_bucket,
        row.quarantine_object_key,
        row.quarantine_object_generation,
      );
      throw error;
    }
  }

  private async dispatchValidation(assetId: string, tenantId: string) {
    try {
      await this.tasks.enqueue({
        assetId,
        tenantId,
        traceId: this.requestContext.getTraceId(),
      });
      await this.prisma.documentBrandAsset.updateMany({
        where: { id: assetId, tenant_id: tenantId, state: 'QUARANTINED' },
        data: { validation_dispatched_at: new Date() },
      });
    } catch {
      // The persisted quarantine row is picked up by the recovery scheduler.
    }
  }
}

type QuarantinedAssetRow = ReturnType<typeof buildQuarantinedAssetRow>;

function buildQuarantinedAssetRow(input: {
  assetId: string;
  tenantId: string;
  legalEntityId: string;
  purpose: DocumentBrandPurpose;
  originalBytes: Buffer;
  detectedMimeType: string;
  originalFilename: string;
  quarantine: { bucket: string; generation: string };
  quarantineObjectKey: string;
}) {
  return {
    id: input.assetId,
    tenant_id: input.tenantId,
    legal_entity_id: input.legalEntityId,
    purpose: input.purpose,
    state: 'QUARANTINED' as const,
    bucket: null,
    object_key: null,
    object_generation: null,
    sha256: createHash('sha256').update(input.originalBytes).digest('hex'),
    byte_length: input.originalBytes.byteLength,
    detected_mime_type: input.detectedMimeType,
    pixel_width: null,
    pixel_height: null,
    original_filename: sanitizeFilename(input.originalFilename),
    quarantine_bucket: input.quarantine.bucket,
    quarantine_object_key: input.quarantineObjectKey,
    quarantine_object_generation: input.quarantine.generation,
    expires_at: new Date(Date.now() + QUARANTINE_EXPIRY_MS),
    failure_code: null,
  };
}

/** Locks an active entity for an upload write, or fails with the matching status. */
async function lockActiveLegalEntityForUpload(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
) {
  const entityLock = await tx.legalEntity.updateMany({
    where: { id: legalEntityId, tenant_id: tenantId, is_active: true },
    data: { is_active: true },
  });
  if (entityLock.count === 1) return;
  const existing = await tx.legalEntity.findFirst({
    where: { id: legalEntityId, tenant_id: tenantId },
    select: { id: true },
  });
  if (existing) {
    throw new UnprocessableEntityException({
      code: 'LEGAL_ENTITY_INACTIVE',
      message:
        'Document branding assets cannot be uploaded for an inactive entity.',
    });
  }
  throw new NotFoundException('Legal entity not found');
}
