import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DocumentBrandProfile } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockLegalEntityAndAssertActive } from '../site/document-retarget.helpers.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROVIDER,
  DisabledDocumentBrandingExtractionProvider,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import {
  type DocumentBrandProfileWithSource,
  emptyProfile,
  toProfileResponse,
} from './document-branding-profile.rules.js';

/**
 * Owns the per-entity profile row: tenant and admin gating, the transaction that
 * locks the legal entity before any profile write, and the response mapping shared
 * by the draft, confirmation and read paths.
 */
@Injectable()
export class DocumentBrandingProfileStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Optional()
    @Inject(DOCUMENT_BRAND_EXTRACTION_PROVIDER)
    private readonly extractionProvider: DocumentBrandingExtractionProvider = new DisabledDocumentBrandingExtractionProvider(),
  ) {}

  async getProfile(legalEntityId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await this.findLegalEntity(tenantId, legalEntityId);
    const profile = await this.prisma.documentBrandProfile.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      include: { draftSourceAsset: true },
    });

    return profile
      ? this.toResponse(profile)
      : this.toResponse(emptyProfile(tenantId, legalEntityId));
  }

  requireActiveUser(tenantId: string) {
    return requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);
  }

  async requireActiveLegalEntity(tenantId: string, legalEntityId: string) {
    const entity = await this.findLegalEntity(tenantId, legalEntityId);
    if (!entity.is_active) {
      throw new UnprocessableEntityException({
        code: 'LEGAL_ENTITY_INACTIVE',
        message: 'Document branding cannot be changed for an inactive entity.',
      });
    }
    return entity;
  }

  async withLockedProfile<T>(
    legalEntityId: string,
    action: (
      tx: Prisma.TransactionClient,
      profile: DocumentBrandProfile,
      tenantId: string,
    ) => Promise<T>,
  ): Promise<T> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await this.requireActiveUser(tenantId);
    return this.prisma.$transaction(async (tx) => {
      await lockLegalEntityAndAssertActive(tx, tenantId, legalEntityId);

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

  readProfile(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legalEntityId: string,
  ) {
    return tx.documentBrandProfile.findFirstOrThrow({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      include: { draftSourceAsset: true },
    });
  }

  async readResponse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legalEntityId: string,
  ) {
    return this.toResponse(await this.readProfile(tx, tenantId, legalEntityId));
  }

  toResponse(profile: DocumentBrandProfileWithSource) {
    return toProfileResponse(profile, this.extractionProvider.isAvailable());
  }

  private async findLegalEntity(tenantId: string, legalEntityId: string) {
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: legalEntityId, tenant_id: tenantId },
      select: { id: true, is_active: true },
    });
    if (!entity) throw new NotFoundException('Legal entity not found');
    return entity;
  }
}
