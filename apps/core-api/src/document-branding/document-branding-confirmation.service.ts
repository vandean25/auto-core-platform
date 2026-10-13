import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DocumentBrandProfile } from '@prisma/client';
import { requireReadyLogo } from './document-branding-asset-guards.js';
import { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import {
  assertRevision,
  assertUpdated,
  type ProfileUpdateData,
  requestHashFor,
  startGraceForReleasedDraftSources,
  startGraceForReleasedProfileLogos,
  validateIdempotencyKey,
} from './document-branding-profile.rules.js';
import { validateDocumentBrandTheme } from './theme-v1.js';

type DraftTheme = ReturnType<typeof validateDocumentBrandTheme>;

/**
 * Promotes the draft to the active theme (confirm) or clears the active theme
 * (reset). Both are idempotent per Idempotency-Key and revision-guarded.
 */
@Injectable()
export class DocumentBrandingConfirmationService {
  constructor(private readonly profiles: DocumentBrandingProfileStore) {}

  async confirm(legalEntityId: string, expectedRevision: number, key: string) {
    return this.confirmOrReset(legalEntityId, expectedRevision, key, false);
  }

  async reset(legalEntityId: string, expectedRevision: number, key: string) {
    return this.confirmOrReset(legalEntityId, expectedRevision, key, true);
  }

  private async confirmOrReset(
    legalEntityId: string,
    expectedRevision: number,
    key: string,
    reset: boolean,
  ) {
    const idempotencyKey = validateIdempotencyKey(key);
    const requestHash = requestHashFor(reset, expectedRevision);

    return this.profiles.withLockedProfile(
      legalEntityId,
      async (tx, profile, tenantId) => {
        if (profile.last_confirmation_key === idempotencyKey) {
          return this.replay(profile, requestHash);
        }

        assertRevision(profile, expectedRevision);
        if (!reset && !profile.draft_theme) {
          throw new UnprocessableEntityException({
            code: 'BRAND_DRAFT_REQUIRED',
            message: 'Save a draft before confirming document branding.',
          });
        }

        const currentUser = await this.profiles.requireActiveUser(tenantId);
        const draftTheme = loadDraftTheme(profile);
        await requireReadyLogo(
          tx.documentBrandAsset,
          tenantId,
          legalEntityId,
          confirmedLogoAssetId(reset, draftTheme),
        );

        const revision = profile.revision + 1;
        const result = await tx.documentBrandProfile.updateMany({
          where: {
            id: profile.id,
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            revision: expectedRevision,
          },
          data: confirmedProfileData({
            reset,
            revision,
            draftTheme,
            userId: currentUser.id,
            idempotencyKey,
            requestHash,
          }),
        });
        assertUpdated(result.count);
        await startGraceForReleasedProfileLogos(tx, tenantId, legalEntityId, [
          profile.active_logo_asset_id,
          profile.draft_logo_asset_id,
        ]);
        await startGraceForReleasedDraftSources(tx, tenantId, legalEntityId, [
          profile.draft_source_asset_id,
        ]);
        return this.profiles.readResponse(tx, tenantId, legalEntityId);
      },
    );
  }

  private replay(profile: DocumentBrandProfile, requestHash: string) {
    if (profile.last_confirmation_hash !== requestHash) {
      throw new ConflictException({
        code: 'BRAND_IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key was already used for another request.',
      });
    }
    return this.profiles.toResponse(profile);
  }
}

function loadDraftTheme(profile: DocumentBrandProfile): DraftTheme | null {
  return profile.draft_theme
    ? validateDocumentBrandTheme(profile.draft_theme)
    : null;
}

function confirmedLogoAssetId(reset: boolean, draftTheme: DraftTheme | null) {
  return reset ? null : (draftTheme?.logoAssetId ?? null);
}

function confirmedProfileData(input: {
  reset: boolean;
  revision: number;
  draftTheme: DraftTheme | null;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
}): ProfileUpdateData {
  return {
    revision: input.revision,
    active_revision: input.revision,
    active_theme: input.reset
      ? Prisma.DbNull
      : (input.draftTheme as Prisma.InputJsonValue),
    active_logo_asset_id: confirmedLogoAssetId(input.reset, input.draftTheme),
    draft_theme: Prisma.DbNull,
    draft_logo_asset_id: null,
    draft_source_asset_id: null,
    draft_extraction_id: null,
    confirmed_at: new Date(),
    confirmed_by_user_id: input.userId,
    last_confirmation_key: input.idempotencyKey,
    last_confirmation_hash: input.requestHash,
    last_confirmation_result_revision: input.revision,
  };
}
