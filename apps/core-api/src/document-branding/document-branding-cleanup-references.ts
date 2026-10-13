import { Prisma } from '@prisma/client';
import { startDerivedLogoGraceIfUnreferenced } from './document-branding-extraction-retention.js';

export type CleanupTx = Prisma.TransactionClient;

export type CleanupAssetRef = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
};

export async function hasCleanupReferences(
  tx: CleanupTx,
  asset: CleanupAssetRef,
): Promise<boolean> {
  const [
    profileReference,
    derivedAsset,
    invoiceReference,
    extractionReference,
  ] = await Promise.all([
    tx.documentBrandProfile.findFirst({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        OR: [
          { active_logo_asset_id: asset.id },
          { draft_logo_asset_id: asset.id },
          { draft_source_asset_id: asset.id },
        ],
      },
      select: { id: true },
    }),
    tx.documentBrandAsset.findFirst({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        source_asset_id: asset.id,
      },
      select: { id: true },
    }),
    tx.invoiceBrandAssetReference.findFirst({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        asset_id: asset.id,
      },
      select: { id: true },
    }),
    tx.documentBrandExtraction.findFirst({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        OR: [
          { source_asset_id: asset.id, state: { in: ['QUEUED', 'RUNNING'] } },
          {
            proposal_logo_asset_id: asset.id,
            expires_at: { gt: new Date() },
          },
        ],
      },
      select: { id: true },
    }),
  ]);
  return Boolean(
    profileReference || derivedAsset || invoiceReference || extractionReference,
  );
}

export async function releaseExpiredExtractionReferences(
  tx: CleanupTx,
  current: { id: string; purpose: 'SOURCE' | 'LOGO' },
  asset: CleanupAssetRef,
): Promise<boolean> {
  const now = new Date();
  if (current.purpose === 'SOURCE') {
    await tx.documentBrandAsset.updateMany({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        source_asset_id: current.id,
      },
      data: { source_asset_id: null },
    });
    await tx.documentBrandExtraction.updateMany({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        source_asset_id: current.id,
        state: { in: ['QUEUED', 'RUNNING'] },
      },
      data: {
        state: 'FAILED',
        failure_code: 'BRAND_SOURCE_EXPIRED',
        lease_token: null,
        lease_until: null,
        completed_at: now,
        expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.documentBrandExtraction.updateMany({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        source_asset_id: current.id,
      },
      data: { source_asset_id: null },
    });
  }
  const released = await tx.documentBrandExtraction.updateMany({
    where: {
      tenant_id: asset.tenant_id,
      legal_entity_id: asset.legal_entity_id,
      proposal_logo_asset_id: current.id,
      expires_at: { lte: now },
    },
    data: { proposal: Prisma.JsonNull, proposal_logo_asset_id: null },
  });
  if (released.count > 0 && current.purpose === 'LOGO') {
    return startDerivedLogoGraceIfUnreferenced(tx, {
      tenantId: asset.tenant_id,
      legalEntityId: asset.legal_entity_id,
      assetId: current.id,
      now,
    });
  }
  return false;
}
