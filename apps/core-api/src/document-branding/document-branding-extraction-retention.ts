import type { Prisma } from '@prisma/client';

const DERIVED_LOGO_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_SOURCE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type LogoRetentionInput = {
  tenantId: string;
  legalEntityId: string;
  assetId: string;
  now: Date;
};

export async function startDerivedLogoGraceIfUnreferenced(
  tx: Prisma.TransactionClient,
  input: LogoRetentionInput,
): Promise<boolean> {
  const scope = {
    tenant_id: input.tenantId,
    legal_entity_id: input.legalEntityId,
  };
  const [profile, invoiceReference, proposal] = await Promise.all([
    tx.documentBrandProfile.findFirst({
      where: {
        ...scope,
        OR: [
          { active_logo_asset_id: input.assetId },
          { draft_logo_asset_id: input.assetId },
        ],
      },
      select: { id: true },
    }),
    tx.invoiceBrandAssetReference.findFirst({
      where: { ...scope, asset_id: input.assetId },
      select: { id: true },
    }),
    tx.documentBrandExtraction.findFirst({
      where: {
        ...scope,
        proposal_logo_asset_id: input.assetId,
        state: 'SUCCEEDED',
        expires_at: { gt: input.now },
      },
      select: { id: true },
    }),
  ]);
  if (profile || invoiceReference || proposal) return false;

  const updated = await tx.documentBrandAsset.updateMany({
    where: {
      id: input.assetId,
      ...scope,
      purpose: 'LOGO',
      state: 'READY',
      OR: [{ expires_at: null }, { expires_at: { lte: input.now } }],
    },
    data: {
      expires_at: new Date(input.now.getTime() + DERIVED_LOGO_GRACE_MS),
    },
  });
  return updated.count === 1;
}

export async function startDraftSourceGraceIfUnreferenced(
  tx: Prisma.TransactionClient,
  input: LogoRetentionInput,
): Promise<boolean> {
  const scope = {
    tenant_id: input.tenantId,
    legal_entity_id: input.legalEntityId,
  };
  const [profile, extraction, derivedLogo] = await Promise.all([
    tx.documentBrandProfile.findFirst({
      where: { ...scope, draft_source_asset_id: input.assetId },
      select: { id: true },
    }),
    tx.documentBrandExtraction.findFirst({
      where: {
        ...scope,
        source_asset_id: input.assetId,
        OR: [
          { state: { in: ['QUEUED', 'RUNNING'] } },
          { expires_at: { gt: input.now } },
        ],
      },
      select: { id: true },
    }),
    tx.documentBrandAsset.findFirst({
      where: { ...scope, source_asset_id: input.assetId },
      select: { id: true },
    }),
  ]);
  if (profile || extraction || derivedLogo) return false;

  const updated = await tx.documentBrandAsset.updateMany({
    where: {
      id: input.assetId,
      ...scope,
      purpose: 'SOURCE',
      state: { in: ['QUARANTINED', 'READY', 'REJECTED'] },
      OR: [{ expires_at: null }, { expires_at: { lte: input.now } }],
    },
    data: {
      expires_at: new Date(input.now.getTime() + DRAFT_SOURCE_GRACE_MS),
    },
  });
  return updated.count === 1;
}
