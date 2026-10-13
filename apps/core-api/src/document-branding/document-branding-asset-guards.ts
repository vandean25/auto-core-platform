import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type AssetRepository = Prisma.TransactionClient['documentBrandAsset'];

const ATTACHABLE_SOURCE_STATES = ['QUARANTINED', 'READY', 'REJECTED'];

export async function requireDraftSourceAsset(
  assetRepository: AssetRepository,
  tenantId: string,
  legalEntityId: string,
  assetId: string,
) {
  const asset = await assetRepository.findFirst({
    where: {
      id: assetId,
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      purpose: 'SOURCE',
    },
    select: { id: true, state: true },
  });
  if (!asset) {
    throw new NotFoundException('Letterhead source asset not found');
  }
  if (!ATTACHABLE_SOURCE_STATES.includes(asset.state)) {
    throw new UnprocessableEntityException({
      code: 'BRAND_ASSET_NOT_ATTACHABLE',
      message: 'This letterhead source can no longer be attached to the draft.',
    });
  }
}

export async function requireReadyLogo(
  assetRepository: AssetRepository,
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
    },
    select: { id: true, state: true },
  });
  if (!asset) throw new NotFoundException('Logo asset not found');
  if (asset.state !== 'READY') {
    throw new UnprocessableEntityException({
      code: 'BRAND_ASSET_NOT_READY',
      message: 'The logo asset is not ready for use.',
    });
  }
}
