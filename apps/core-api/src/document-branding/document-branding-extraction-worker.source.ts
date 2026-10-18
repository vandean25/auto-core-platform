import type { PrismaService } from '../prisma/prisma.service.js';
import { ExtractionFailure } from './document-branding-extraction-worker.errors.js';

type ClaimedExtraction = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  source_asset_id: string | null;
  requested_by_user_id: string | null;
};

export async function readAuthorizedExtractionSource(
  prisma: PrismaService,
  extraction: ClaimedExtraction,
  tenantId: string,
) {
  if (!extraction.source_asset_id) {
    throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
  }
  if (!extraction.requested_by_user_id) {
    throw new ExtractionFailure('BRAND_REQUESTER_UNAVAILABLE');
  }
  const [membership, entity, source] = await Promise.all([
    prisma.tenantMember.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: extraction.requested_by_user_id,
        is_active: true,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { id: true },
    }),
    prisma.legalEntity.findFirst({
      where: {
        id: extraction.legal_entity_id,
        tenant_id: tenantId,
        is_active: true,
      },
      select: { id: true },
    }),
    prisma.documentBrandAsset.findFirst({
      where: {
        id: extraction.source_asset_id,
        tenant_id: tenantId,
        legal_entity_id: extraction.legal_entity_id,
        purpose: 'SOURCE',
        state: 'READY',
        expires_at: { gt: new Date() },
      },
    }),
  ]);
  if (!membership) throw new ExtractionFailure('BRAND_REQUESTER_REVOKED');
  if (!entity) throw new ExtractionFailure('LEGAL_ENTITY_INACTIVE');
  if (
    !source ||
    !source.bucket ||
    !source.object_key ||
    !source.object_generation
  ) {
    throw new ExtractionFailure('BRAND_SOURCE_EXPIRED');
  }
  return source;
}
