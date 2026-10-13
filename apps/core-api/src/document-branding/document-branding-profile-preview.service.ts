import {
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { requireReadyLogo } from './document-branding-asset-guards.js';
import { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import {
  createDocumentBrandPreview,
  type DocumentBrandSample,
} from './document-branding-preview.js';
import { validateDocumentBrandTheme } from './theme-v1.js';

const MAX_PREVIEW_REQUEST_BYTES = 16 * 1024;
const MAX_PREVIEW_RESPONSE_BYTES = 8 * 1024 * 1024;
const PREVIEW_QUOTA_WINDOW_MS = 60 * 1000;
const PREVIEW_QUOTA_LIMIT = 30;

/** Renders a synthetic preview for an unsaved theme, rate limited per user. */
@Injectable()
export class DocumentBrandingProfilePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly profiles: DocumentBrandingProfileStore,
    @Optional() private readonly assetStorage?: DocumentBrandingAssetStorage,
  ) {}

  async preview(
    legalEntityId: string,
    theme: unknown,
    sample: DocumentBrandSample,
  ) {
    assertPreviewRequestWithinLimit(theme, sample);
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await this.profiles.requireActiveUser(tenantId);
    await this.consumePreviewQuota(tenantId, currentUser.id);
    await this.profiles.requireActiveLegalEntity(tenantId, legalEntityId);
    const validatedTheme = validateDocumentBrandTheme(theme);
    await requireReadyLogo(
      this.prisma.documentBrandAsset,
      tenantId,
      legalEntityId,
      validatedTheme.logoAssetId,
    );
    const logoDataUri = validatedTheme.logoAssetId
      ? await this.readLogoDataUri(
          tenantId,
          legalEntityId,
          validatedTheme.logoAssetId,
        )
      : undefined;
    const preview = createDocumentBrandPreview(
      validatedTheme,
      sample,
      logoDataUri,
    );
    assertPreviewResponseWithinLimit(preview.html);
    return preview;
  }

  private async consumePreviewQuota(tenantId: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const minuteAgo = new Date(Date.now() - PREVIEW_QUOTA_WINDOW_MS);
      await tx.documentBrandQuotaLock.upsert({
        where: {
          tenant_id_action_scope_key: {
            tenant_id: tenantId,
            action: 'PREVIEW',
            scope_key: `user:${userId}`,
          },
        },
        create: {
          tenant_id: tenantId,
          action: 'PREVIEW',
          scope_key: `user:${userId}`,
        },
        update: { updated_at: new Date() },
      });
      await tx.documentBrandQuotaEvent.deleteMany({
        where: {
          tenant_id: tenantId,
          action: 'PREVIEW',
          created_at: { lt: minuteAgo },
        },
      });
      const recentPreviews = await tx.documentBrandQuotaEvent.count({
        where: {
          tenant_id: tenantId,
          user_id: userId,
          action: 'PREVIEW',
          created_at: { gte: minuteAgo },
        },
      });
      if (recentPreviews >= PREVIEW_QUOTA_LIMIT) {
        throw new HttpException(
          {
            code: 'BRAND_PREVIEW_QUOTA_EXCEEDED',
            message: 'The document branding preview limit has been reached.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await tx.documentBrandQuotaEvent.create({
        data: {
          tenant_id: tenantId,
          user_id: userId,
          action: 'PREVIEW',
        },
      });
    });
  }

  private async readLogoDataUri(
    tenantId: string,
    legalEntityId: string,
    logoAssetId: string,
  ) {
    const logo = await this.prisma.documentBrandAsset.findFirst({
      where: {
        id: logoAssetId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        purpose: 'LOGO',
        state: 'READY',
      },
      select: {
        bucket: true,
        object_key: true,
        object_generation: true,
      },
    });
    if (
      !logo?.bucket ||
      !logo.object_key ||
      !logo.object_generation ||
      !this.assetStorage
    ) {
      throw new UnprocessableEntityException({
        code: 'BRAND_PREVIEW_ASSET_UNAVAILABLE',
        message: 'The selected logo is not available for preview.',
      });
    }
    const bytes = await this.assetStorage.readGeneration(
      logo.bucket,
      logo.object_key,
      logo.object_generation,
    );
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }
}

function assertPreviewRequestWithinLimit(
  theme: unknown,
  sample: DocumentBrandSample,
) {
  if (
    Buffer.byteLength(JSON.stringify({ theme, sample }), 'utf8') >
    MAX_PREVIEW_REQUEST_BYTES
  ) {
    throw new UnprocessableEntityException({
      code: 'BRAND_PREVIEW_TOO_LARGE',
      message: 'The synthetic preview request exceeds its size limit.',
    });
  }
}

function assertPreviewResponseWithinLimit(html: string) {
  if (Buffer.byteLength(html, 'utf8') > MAX_PREVIEW_RESPONSE_BYTES) {
    throw new UnprocessableEntityException({
      code: 'BRAND_PREVIEW_TOO_LARGE',
      message: 'The generated preview exceeds its size limit.',
    });
  }
}
