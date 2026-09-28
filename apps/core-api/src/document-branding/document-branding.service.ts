import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DocumentBrandProfile } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import type { SaveDocumentBrandDraftDto } from './dto/document-branding.dto.js';
import {
  createDocumentBrandPreview,
  type DocumentBrandSample,
} from './document-branding-preview.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  validateDocumentBrandTheme,
} from './theme-v1.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const MAX_PREVIEW_REQUEST_BYTES = 16 * 1024;
const MAX_PREVIEW_RESPONSE_BYTES = 8 * 1024 * 1024;

@Injectable()
export class DocumentBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Optional() private readonly assetStorage?: DocumentBrandingAssetStorage,
  ) {}

  async getProfile(legalEntityId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await this.findLegalEntity(tenantId, legalEntityId);
    const profile = await this.prisma.documentBrandProfile.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    });

    return profile
      ? this.toResponse(profile)
      : this.toResponse(this.emptyProfile(tenantId, legalEntityId));
  }

  async saveDraft(legalEntityId: string, dto: SaveDocumentBrandDraftDto) {
    const theme = validateDocumentBrandTheme(dto.theme);
    return this.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        this.assertRevision(profile, dto.expectedRevision);
        await this.requireReadyLogo(
          tx.documentBrandAsset,
          tenantId,
          legalEntityId,
          theme.logoAssetId,
        );
        const revision = profile.revision + 1;
        await tx.documentBrandProfile
          .updateMany({
            where: {
              id: profile.id,
              tenant_id: tenantId,
              legal_entity_id: legalEntityId,
              revision: dto.expectedRevision,
            },
            data: {
              revision,
              draft_theme: theme,
              draft_logo_asset_id: theme.logoAssetId,
              last_confirmation_key: null,
              last_confirmation_hash: null,
              last_confirmation_result_revision: null,
            },
          })
          .then((result) => this.assertUpdated(result.count));
        return this.toResponse(
          await this.readProfile(tx, tenantId, legalEntityId),
        );
      },
    );
  }

  async discardDraft(legalEntityId: string, expectedRevision: number) {
    return this.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        this.assertRevision(profile, expectedRevision);
        if (!profile.draft_theme) return this.toResponse(profile);

        const revision = profile.revision + 1;
        const result = await tx.documentBrandProfile.updateMany({
          where: {
            id: profile.id,
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            revision: expectedRevision,
          },
          data: {
            revision,
            draft_theme: Prisma.DbNull,
            draft_logo_asset_id: null,
            last_confirmation_key: null,
            last_confirmation_hash: null,
            last_confirmation_result_revision: null,
          },
        });
        this.assertUpdated(result.count);
        return this.toResponse(
          await this.readProfile(tx, tenantId, legalEntityId),
        );
      },
    );
  }

  async confirm(legalEntityId: string, expectedRevision: number, key: string) {
    return this.confirmOrReset(legalEntityId, expectedRevision, key, false);
  }

  async reset(legalEntityId: string, expectedRevision: number, key: string) {
    return this.confirmOrReset(legalEntityId, expectedRevision, key, true);
  }

  async preview(
    legalEntityId: string,
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
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    await this.prisma.$transaction(async (tx) => {
      const minuteAgo = new Date(Date.now() - 60 * 1000);
      await tx.documentBrandQuotaLock.upsert({
        where: {
          tenant_id_action_scope_key: {
            tenant_id: tenantId,
            action: 'PREVIEW',
            scope_key: `user:${currentUser.id}`,
          },
        },
        create: {
          tenant_id: tenantId,
          action: 'PREVIEW',
          scope_key: `user:${currentUser.id}`,
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
          user_id: currentUser.id,
          action: 'PREVIEW',
          created_at: { gte: minuteAgo },
        },
      });
      if (recentPreviews >= 30) {
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
          user_id: currentUser.id,
          action: 'PREVIEW',
        },
      });
    });
    await this.requireActiveLegalEntity(tenantId, legalEntityId);
    const validatedTheme = validateDocumentBrandTheme(theme);
    await this.requireReadyLogo(
      this.prisma.documentBrandAsset,
      tenantId,
      legalEntityId,
      validatedTheme.logoAssetId,
    );
    let logoDataUri: string | undefined;
    if (validatedTheme.logoAssetId) {
      const logo = await this.prisma.documentBrandAsset.findFirst({
        where: {
          id: validatedTheme.logoAssetId,
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
      logoDataUri = `data:image/png;base64,${bytes.toString('base64')}`;
    }
    const preview = createDocumentBrandPreview(
      validatedTheme,
      sample,
      logoDataUri,
    );
    if (Buffer.byteLength(preview.html, 'utf8') > MAX_PREVIEW_RESPONSE_BYTES) {
      throw new UnprocessableEntityException({
        code: 'BRAND_PREVIEW_TOO_LARGE',
        message: 'The generated preview exceeds its size limit.',
      });
    }
    return preview;
  }

  private async confirmOrReset(
    legalEntityId: string,
    expectedRevision: number,
    key: string,
    reset: boolean,
  ) {
    const idempotencyKey = this.validateIdempotencyKey(key);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          action: reset ? 'reset' : 'confirm',
          expectedRevision,
        }),
      )
      .digest('hex');

    return this.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        if (profile.last_confirmation_key === idempotencyKey) {
          if (profile.last_confirmation_hash !== requestHash) {
            throw new ConflictException({
              code: 'BRAND_IDEMPOTENCY_CONFLICT',
              message: 'Idempotency key was already used for another request.',
            });
          }
          return this.toResponse(profile);
        }

        this.assertRevision(profile, expectedRevision);
        if (!reset && !profile.draft_theme) {
          throw new UnprocessableEntityException({
            code: 'BRAND_DRAFT_REQUIRED',
            message: 'Save a draft before confirming document branding.',
          });
        }

        const currentUser = await requireActiveCurrentUser(
          this.prisma,
          this.tenantContext,
          tenantId,
        );
        const draftTheme = profile.draft_theme
          ? validateDocumentBrandTheme(profile.draft_theme)
          : null;
        await this.requireReadyLogo(
          tx.documentBrandAsset,
          tenantId,
          legalEntityId,
          reset ? null : (draftTheme?.logoAssetId ?? null),
        );

        const revision = profile.revision + 1;
        const result = await tx.documentBrandProfile.updateMany({
          where: {
            id: profile.id,
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            revision: expectedRevision,
          },
          data: {
            revision,
            active_revision: revision,
            active_theme: reset
              ? Prisma.DbNull
              : (draftTheme as Prisma.InputJsonValue),
            active_logo_asset_id: reset
              ? null
              : (draftTheme?.logoAssetId ?? null),
            draft_theme: Prisma.DbNull,
            draft_logo_asset_id: null,
            confirmed_at: new Date(),
            confirmed_by_user_id: currentUser.id,
            last_confirmation_key: idempotencyKey,
            last_confirmation_hash: requestHash,
            last_confirmation_result_revision: revision,
          },
        });
        this.assertUpdated(result.count);
        return this.toResponse(
          await this.readProfile(tx, tenantId, legalEntityId),
        );
      },
    );
  }

  private async withLockedProfile<T>(
    legalEntityId: string,
    action: (
      tx: Prisma.TransactionClient,
      profile: DocumentBrandProfile,
      tenantId: string,
    ) => Promise<T>,
  ): Promise<T> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);
    return this.prisma.$transaction(async (tx) => {
      const lockResult = await tx.legalEntity.updateMany({
        where: {
          id: legalEntityId,
          tenant_id: tenantId,
          is_active: true,
        },
        data: { is_active: true },
      });
      if (lockResult.count === 0) {
        const entity = await tx.legalEntity.findFirst({
          where: { id: legalEntityId, tenant_id: tenantId },
          select: { id: true },
        });
        if (entity) {
          throw new UnprocessableEntityException({
            code: 'LEGAL_ENTITY_INACTIVE',
            message:
              'Document branding cannot be changed for an inactive entity.',
          });
        }
        throw new NotFoundException('Legal entity not found');
      }

      let profile = await tx.documentBrandProfile.findFirst({
        where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      });
      if (!profile) {
        profile = await tx.documentBrandProfile.create({
          data: {
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            revision: 0,
          },
        });
      }

      return action(tx, profile, tenantId);
    });
  }

  private async findLegalEntity(tenantId: string, legalEntityId: string) {
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: legalEntityId, tenant_id: tenantId },
      select: { id: true, is_active: true },
    });
    if (!entity) throw new NotFoundException('Legal entity not found');
    return entity;
  }

  private async requireActiveLegalEntity(
    tenantId: string,
    legalEntityId: string,
  ) {
    const entity = await this.findLegalEntity(tenantId, legalEntityId);
    if (!entity.is_active) {
      throw new UnprocessableEntityException({
        code: 'LEGAL_ENTITY_INACTIVE',
        message: 'Document branding cannot be changed for an inactive entity.',
      });
    }
    return entity;
  }

  private async requireReadyLogo(
    assetRepository: Prisma.TransactionClient['documentBrandAsset'],
    tenantId: string,
    legalEntityId: string,
    assetId: string | null,
  ) {
    if (!assetId) return;
    const asset = await assetRepository.findFirst({
      where: {
        id: assetId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        purpose: 'LOGO',
        state: 'READY',
      },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Ready logo asset not found');
  }

  private async readProfile(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legalEntityId: string,
  ) {
    return tx.documentBrandProfile.findFirstOrThrow({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    });
  }

  private emptyProfile(tenantId: string, legalEntityId: string) {
    return {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      revision: 0,
      active_revision: 0,
      active_theme: null,
      draft_theme: null,
      active_logo_asset_id: null,
      draft_logo_asset_id: null,
      confirmed_at: null,
      confirmed_by_user_id: null,
    } as DocumentBrandProfile;
  }

  private toResponse(profile: DocumentBrandProfile) {
    return {
      revision: profile.revision,
      activeRevision: profile.active_revision,
      activeTheme: profile.active_theme
        ? validateDocumentBrandTheme(profile.active_theme)
        : DEFAULT_DOCUMENT_BRAND_THEME,
      draftTheme: profile.draft_theme
        ? validateDocumentBrandTheme(profile.draft_theme)
        : null,
      confirmedAt: profile.confirmed_at,
      confirmedByUserId: profile.confirmed_by_user_id,
      capabilities: { extractionAvailable: false },
    };
  }

  private assertRevision(
    profile: DocumentBrandProfile,
    expectedRevision: number,
  ) {
    if (profile.revision !== expectedRevision) {
      throw new ConflictException({
        code: 'BRAND_REVISION_CONFLICT',
        message: `Branding revision conflict: expected ${expectedRevision}, current ${profile.revision}.`,
      });
    }
  }

  private assertUpdated(count: number) {
    if (count !== 1) {
      throw new ConflictException({
        code: 'BRAND_REVISION_CONFLICT',
        message:
          'Document branding changed while this request was being saved.',
      });
    }
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
    return value;
  }
}
