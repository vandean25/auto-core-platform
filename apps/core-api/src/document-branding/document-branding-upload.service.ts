import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentBrandAsset } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

@Injectable()
export class DocumentBrandingUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly tasks: DocumentBrandingUploadTaskService,
  ) {}

  async upload(
    legalEntityId: string,
    purposeValue: string,
    file: Express.Multer.File | undefined,
  ) {
    const purpose = this.requirePurpose(purposeValue);
    const originalBytes = this.requireUpload(file, purpose);
    const detectedMimeType = detectMimeType(originalBytes);
    this.assertPurposeSupportsMime(purpose, detectedMimeType);

    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
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

    const assetId = randomUUID();
    const rootKey = `tenants/${tenantId}/legal-entities/${legalEntityId}/document-branding`;
    const quarantineObjectKey = `${rootKey}/quarantine/${assetId}`;
    await this.prisma.$transaction(async (tx) => {
      const entityLock = await tx.legalEntity.updateMany({
        where: { id: legalEntityId, tenant_id: tenantId, is_active: true },
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
              'Document branding assets cannot be uploaded for an inactive entity.',
          });
        }
        throw new NotFoundException('Legal entity not found');
      }
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
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
      if (recentUploads >= 20) {
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
          user_id: currentUser.id,
          action: 'ASSET_UPLOAD',
        },
      });
    });
    const quarantine = await this.storage.storeImmutable({
      objectKey: quarantineObjectKey,
      bytes: originalBytes,
      contentType: 'application/octet-stream',
    });
    const assetData = {
      id: assetId,
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      purpose,
      state: 'QUARANTINED' as const,
      bucket: null,
      object_key: null,
      object_generation: null,
      sha256: createHash('sha256').update(originalBytes).digest('hex'),
      byte_length: originalBytes.byteLength,
      detected_mime_type: detectedMimeType,
      pixel_width: null,
      pixel_height: null,
      original_filename: sanitizeFilename(file?.originalname ?? ''),
      quarantine_bucket: quarantine.bucket,
      quarantine_object_key: quarantineObjectKey,
      quarantine_object_generation: quarantine.generation,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      failure_code: null,
    };
    let asset: DocumentBrandAsset;
    try {
      asset = await this.prisma.$transaction(async (tx) => {
        const entityLock = await tx.legalEntity.updateMany({
          where: { id: legalEntityId, tenant_id: tenantId, is_active: true },
          data: { is_active: true },
        });
        if (entityLock.count !== 1) {
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
        return tx.documentBrandAsset.create({ data: assetData });
      });
    } catch (error) {
      await this.storage.deleteGeneration(
        quarantine.bucket,
        quarantineObjectKey,
        quarantine.generation,
      );
      throw error;
    }
    try {
      await this.tasks.enqueue({ assetId, tenantId });
      await this.prisma.documentBrandAsset.updateMany({
        where: { id: assetId, tenant_id: tenantId, state: 'QUARANTINED' },
        data: { validation_dispatched_at: new Date() },
      });
    } catch {
      // The persisted quarantine row is picked up by the recovery scheduler.
    }
    return toAssetResponse(asset);
  }

  async getAsset(legalEntityId: string, assetId: string) {
    const tenantId = await this.authorizeReader();
    const asset = await this.findAsset(tenantId, legalEntityId, assetId);
    return toAssetResponse(asset);
  }

  async getAssetContent(legalEntityId: string, assetId: string) {
    const tenantId = await this.authorizeReader();
    const asset = await this.findAsset(tenantId, legalEntityId, assetId);
    if (
      asset.state !== 'READY' ||
      !asset.bucket ||
      !asset.object_key ||
      !asset.object_generation
    ) {
      throw new UnprocessableEntityException({
        code: 'BRAND_ASSET_NOT_READY',
        message: 'This document branding asset is not ready to download.',
      });
    }
    return {
      bytes: await this.storage.readGeneration(
        asset.bucket,
        asset.object_key,
        asset.object_generation,
      ),
      contentType: asset.detected_mime_type ?? 'application/octet-stream',
      purpose: asset.purpose,
    };
  }

  private async authorizeReader() {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);
    return tenantId;
  }

  private async findAsset(
    tenantId: string,
    legalEntityId: string,
    assetId: string,
  ) {
    const asset = await this.prisma.documentBrandAsset.findFirst({
      where: {
        id: assetId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
      },
    });
    if (!asset)
      throw new NotFoundException('Document branding asset not found');
    return asset;
  }

  private requirePurpose(value: string): 'SOURCE' | 'LOGO' {
    if (value !== 'SOURCE' && value !== 'LOGO') {
      throw new BadRequestException('Asset purpose must be SOURCE or LOGO.');
    }
    return value;
  }

  private requireUpload(
    file: Express.Multer.File | undefined,
    purpose: 'SOURCE' | 'LOGO',
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A file upload is required.');
    }
    const limit = purpose === 'LOGO' ? MAX_LOGO_BYTES : MAX_SOURCE_BYTES;
    if (file.size > limit || file.buffer.byteLength > limit) {
      throw new PayloadTooLargeException({
        code: 'BRAND_UPLOAD_TOO_LARGE',
        message: 'Document branding upload exceeds its size limit.',
      });
    }
    return file.buffer;
  }

  private assertPurposeSupportsMime(
    purpose: 'SOURCE' | 'LOGO',
    detectedMimeType: string,
  ) {
    if (purpose === 'LOGO' && detectedMimeType !== 'image/png') {
      throw new UnsupportedMediaTypeException({
        code: 'BRAND_FILE_TYPE_UNSUPPORTED',
        message: 'Logo assets must be PNG images.',
      });
    }
    if (
      purpose === 'SOURCE' &&
      detectedMimeType !== 'image/png' &&
      detectedMimeType !== 'application/pdf'
    ) {
      throw new UnsupportedMediaTypeException({
        code: 'BRAND_FILE_TYPE_UNSUPPORTED',
        message: 'Source assets must be PDF or PNG files.',
      });
    }
  }
}

function detectMimeType(bytes: Buffer): string {
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}

function sanitizeFilename(filename: string): string | null {
  const normalized = filename
    .normalize('NFC')
    .replace(/[\\/\p{Cc}\p{Cf}]/gu, ' ')
    .trim()
    .slice(0, 255);
  return normalized.length > 0 ? normalized : null;
}

export function mapDocumentBrandAssetResponse(asset: {
  id: string;
  purpose: string;
  state: string;
  detected_mime_type: string | null;
  byte_length: number;
  pixel_width: number | null;
  pixel_height: number | null;
  failure_code: string | null;
  original_filename: string | null;
  createdAt: Date;
  expires_at: Date | null;
}) {
  return {
    id: asset.id,
    purpose: asset.purpose,
    state: asset.state,
    detectedMimeType: asset.detected_mime_type,
    byteLength: asset.byte_length,
    pixelWidth: asset.pixel_width,
    pixelHeight: asset.pixel_height,
    failureCode: asset.failure_code,
    originalFilename: asset.original_filename,
    createdAt: asset.createdAt,
    expiresAt: asset.expires_at,
  };
}

function toAssetResponse(asset: {
  id: string;
  purpose: string;
  state: string;
  detected_mime_type: string | null;
  byte_length: number;
  pixel_width: number | null;
  pixel_height: number | null;
  failure_code: string | null;
  original_filename: string | null;
  createdAt: Date;
  expires_at: Date | null;
}) {
  return mapDocumentBrandAssetResponse(asset);
}
