import type { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { tierFilter, type MatchTier } from '../search-ranking.js';
import type { SearchContext } from '../search.types.js';

/**
 * Resolves entity IDs matching an external (legacy/incadea) number on exact or prefix tiers.
 * Returns `[]` for multi-word queries, emails, UUIDs, or contains-tier queries.
 */
export async function findMatchingExternalEntityIds(
  prisma: PrismaService,
  ctx: SearchContext,
  entityType: ImportEntityType,
  tier: MatchTier,
): Promise<string[]> {
  if (
    tier === 'contains' ||
    ctx.query.kind === 'uuid' ||
    ctx.query.kind === 'email' ||
    ctx.query.terms.length !== 1 ||
    !prisma.externalIdMapping?.findMany
  ) {
    return [];
  }
  const rows = await prisma.externalIdMapping.findMany({
    where: {
      tenant_id: ctx.tenantId,
      entity_type: entityType,
      external_id: tierFilter(tier, ctx.query.text),
    },
    select: { entity_id: true },
    orderBy: [{ external_id: 'asc' }, { id: 'asc' }],
    take: ctx.limit,
  });
  return [...new Set(rows.map((row) => row.entity_id))];
}
