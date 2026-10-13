import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { mapDocumentBrandAssetResponse } from './document-branding-upload.rules.js';

/** Read paths for uploaded branding assets: metadata, page preview and stored bytes. */
@Injectable()
export class DocumentBrandingAssetReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: DocumentBrandingAssetStorage,
  ) {}

  async getAsset(legalEntityId: string, assetId: string) {
    const tenantId = await this.authorizeReader();
    const asset = await this.findAsset(tenantId, legalEntityId, assetId);
    return mapDocumentBrandAssetResponse(asset);
  }

  async getAssetPagePreview(legalEntityId: string, assetId: string) {
    const tenantId = await this.authorizeReader();
    const asset = await this.findAsset(tenantId, legalEntityId, assetId);
    if (
      asset.state !== 'READY' ||
      !asset.preview_bucket ||
      !asset.preview_object_key ||
      !asset.preview_object_generation
    ) {
      throw new UnprocessableEntityException({
        code: 'BRAND_ASSET_PREVIEW_UNAVAILABLE',
        message: 'This document branding asset has no page preview.',
      });
    }
    return {
      bytes: await this.storage.readGeneration(
        asset.preview_bucket,
        asset.preview_object_key,
        asset.preview_object_generation,
      ),
      contentType: 'image/png',
    };
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
}
