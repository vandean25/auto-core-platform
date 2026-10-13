import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DocumentBrandProfile, Prisma } from '@prisma/client';
import {
  startDerivedLogoGraceIfUnreferenced,
  startDraftSourceGraceIfUnreferenced,
} from './document-branding-extraction-retention.js';
import { documentBrandProfileCapabilities } from './document-branding-limits.js';
import {
  type DocumentBrandAssetSummary,
  mapDocumentBrandAssetResponse,
} from './document-branding-upload.rules.js';
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  validateDocumentBrandTheme,
} from './theme-v1.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]+$/;

export type DocumentBrandProfileWithSource = DocumentBrandProfile & {
  draftSourceAsset?: DocumentBrandAssetSummary | null;
};

export type ProfileUpdateData = Parameters<
  Prisma.TransactionClient['documentBrandProfile']['updateMany']
>[0]['data'];

export function assertRevision(
  profile: Pick<DocumentBrandProfile, 'revision'>,
  expectedRevision: number,
) {
  if (profile.revision !== expectedRevision) {
    throw new ConflictException({
      code: 'BRAND_REVISION_CONFLICT',
      message: `Branding revision conflict: expected ${expectedRevision}, current ${profile.revision}.`,
    });
  }
}

export function assertUpdated(count: number) {
  if (count !== 1) {
    throw new ConflictException({
      code: 'BRAND_REVISION_CONFLICT',
      message: 'Document branding changed while this request was being saved.',
    });
  }
}

export function validateIdempotencyKey(value: string) {
  if (!isWellFormedIdempotencyKey(value)) {
    throw new UnprocessableEntityException({
      code: 'BRAND_IDEMPOTENCY_KEY_INVALID',
      message: 'A valid Idempotency-Key header is required.',
    });
  }
  return value;
}

export function requestHashFor(reset: boolean, expectedRevision: number) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        action: reset ? 'reset' : 'confirm',
        expectedRevision,
      }),
    )
    .digest('hex');
}

export function emptyProfile(tenantId: string, legalEntityId: string) {
  return {
    tenant_id: tenantId,
    legal_entity_id: legalEntityId,
    revision: 0,
    active_revision: 0,
    active_theme: null,
    draft_theme: null,
    active_logo_asset_id: null,
    draft_logo_asset_id: null,
    draft_source_asset_id: null,
    draft_extraction_id: null,
    confirmed_at: null,
    confirmed_by_user_id: null,
  } as DocumentBrandProfile;
}

export function toProfileResponse(
  profile: DocumentBrandProfileWithSource,
  extractionAvailable: boolean,
) {
  const draftSourceAsset = profile.draftSourceAsset
    ? mapDocumentBrandAssetResponse(profile.draftSourceAsset)
    : null;
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
    capabilities: documentBrandProfileCapabilities(extractionAvailable),
    draftSourceAssetId: profile.draft_source_asset_id,
    draftSourceAsset,
  };
}

export async function startGraceForReleasedDraftSources(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
  assetIds: Array<string | null>,
) {
  const now = new Date();
  await Promise.all(
    uniqueAssetIds(assetIds).map((assetId) =>
      startDraftSourceGraceIfUnreferenced(tx, {
        tenantId,
        legalEntityId,
        assetId,
        now,
      }),
    ),
  );
}

export async function startGraceForReleasedProfileLogos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
  assetIds: Array<string | null>,
) {
  await Promise.all(
    uniqueAssetIds(assetIds).map((assetId) =>
      startDerivedLogoGraceIfUnreferenced(tx, {
        tenantId,
        legalEntityId,
        assetId,
        now: new Date(),
      }),
    ),
  );
}

function isWellFormedIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= IDEMPOTENCY_KEY_MAX_LENGTH &&
    IDEMPOTENCY_KEY_PATTERN.test(value)
  );
}

function uniqueAssetIds(assetIds: Array<string | null>): string[] {
  return [...new Set(assetIds.filter((id): id is string => !!id))];
}
