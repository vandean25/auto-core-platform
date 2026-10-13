import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DocumentBrandProfile } from '@prisma/client';
import type {
  SaveDocumentBrandDraftDto,
  SaveDocumentBrandDraftSourceDto,
} from './dto/document-branding.dto.js';
import {
  requireDraftSourceAsset,
  requireReadyLogo,
} from './document-branding-asset-guards.js';
import { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import {
  assertRevision,
  assertUpdated,
  type ProfileUpdateData,
  startGraceForReleasedDraftSources,
  startGraceForReleasedProfileLogos,
} from './document-branding-profile.rules.js';
import { validateDocumentBrandTheme } from './theme-v1.js';

/** Draft-side mutations: the revision-guarded draft source, theme and extraction. */
@Injectable()
export class DocumentBrandingDraftService {
  constructor(private readonly profiles: DocumentBrandingProfileStore) {}

  async setDraftSource(
    legalEntityId: string,
    dto: SaveDocumentBrandDraftSourceDto,
  ) {
    return this.profiles.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        assertRevision(profile, dto.expectedRevision);
        await requireDraftSourceAsset(
          tx.documentBrandAsset,
          tenantId,
          legalEntityId,
          dto.sourceAssetId,
        );
        const releasedSourceId = profile.draft_source_asset_id;
        await this.updateAtRevision(
          tx,
          profile,
          tenantId,
          legalEntityId,
          dto.expectedRevision,
          {
            revision: profile.revision + 1,
            draft_source_asset_id: dto.sourceAssetId,
          },
        );
        await startGraceForReleasedDraftSources(tx, tenantId, legalEntityId, [
          releasedSourceId,
        ]);
        return this.profiles.readResponse(tx, tenantId, legalEntityId);
      },
    );
  }

  async removeDraftSource(legalEntityId: string, expectedRevision: number) {
    return this.profiles.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        assertRevision(profile, expectedRevision);
        if (!profile.draft_source_asset_id) {
          return this.profiles.toResponse({
            ...profile,
            draftSourceAsset: null,
          });
        }
        const releasedSourceId = profile.draft_source_asset_id;
        await this.updateAtRevision(
          tx,
          profile,
          tenantId,
          legalEntityId,
          expectedRevision,
          {
            revision: profile.revision + 1,
            draft_source_asset_id: null,
          },
        );
        await startGraceForReleasedDraftSources(tx, tenantId, legalEntityId, [
          releasedSourceId,
        ]);
        return this.profiles.readResponse(tx, tenantId, legalEntityId);
      },
    );
  }

  async saveDraft(legalEntityId: string, dto: SaveDocumentBrandDraftDto) {
    const theme = validateDocumentBrandTheme(dto.theme);
    return this.profiles.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        assertRevision(profile, dto.expectedRevision);
        await requireReadyLogo(
          tx.documentBrandAsset,
          tenantId,
          legalEntityId,
          theme.logoAssetId,
        );
        const draftExtractionId = await this.resolveDraftExtractionId(
          tx,
          profile,
          tenantId,
          legalEntityId,
          dto,
          theme.logoAssetId,
        );
        await this.updateAtRevision(
          tx,
          profile,
          tenantId,
          legalEntityId,
          dto.expectedRevision,
          {
            revision: profile.revision + 1,
            draft_theme: theme,
            draft_logo_asset_id: theme.logoAssetId,
            draft_extraction_id: draftExtractionId,
            last_confirmation_key: null,
            last_confirmation_hash: null,
            last_confirmation_result_revision: null,
          },
        );
        await startGraceForReleasedProfileLogos(tx, tenantId, legalEntityId, [
          profile.draft_logo_asset_id,
        ]);
        return this.profiles.readResponse(tx, tenantId, legalEntityId);
      },
    );
  }

  async discardDraft(legalEntityId: string, expectedRevision: number) {
    return this.profiles.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        assertRevision(profile, expectedRevision);
        if (!profile.draft_theme) return this.profiles.toResponse(profile);

        await this.updateAtRevision(
          tx,
          profile,
          tenantId,
          legalEntityId,
          expectedRevision,
          {
            revision: profile.revision + 1,
            draft_theme: Prisma.DbNull,
            draft_logo_asset_id: null,
            draft_source_asset_id: null,
            draft_extraction_id: null,
            last_confirmation_key: null,
            last_confirmation_hash: null,
            last_confirmation_result_revision: null,
          },
        );
        await startGraceForReleasedProfileLogos(tx, tenantId, legalEntityId, [
          profile.draft_logo_asset_id,
        ]);
        await startGraceForReleasedDraftSources(tx, tenantId, legalEntityId, [
          profile.draft_source_asset_id,
        ]);
        return this.profiles.readResponse(tx, tenantId, legalEntityId);
      },
    );
  }

  private async resolveDraftExtractionId(
    tx: Prisma.TransactionClient,
    profile: DocumentBrandProfile,
    tenantId: string,
    legalEntityId: string,
    dto: SaveDocumentBrandDraftDto,
    logoAssetId: string | null,
  ) {
    if (!dto.extractionId) return profile.draft_extraction_id;
    const extraction = await tx.documentBrandExtraction.findFirst({
      where: {
        id: dto.extractionId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        state: 'SUCCEEDED',
        base_revision: dto.expectedRevision,
        expires_at: { gt: new Date() },
      },
      select: { id: true, proposal_logo_asset_id: true },
    });
    if (!extraction || extraction.proposal_logo_asset_id !== logoAssetId) {
      throw new ConflictException({
        code: 'BRAND_EXTRACTION_STALE',
        message:
          'This extraction proposal is expired or based on another profile revision.',
      });
    }
    return extraction.id;
  }

  private async updateAtRevision(
    tx: Prisma.TransactionClient,
    profile: DocumentBrandProfile,
    tenantId: string,
    legalEntityId: string,
    expectedRevision: number,
    data: ProfileUpdateData,
  ) {
    const result = await tx.documentBrandProfile.updateMany({
      where: {
        id: profile.id,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        revision: expectedRevision,
      },
      data,
    });
    assertUpdated(result.count);
  }
}
