import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  collectRanked,
  tierFilter,
  type MatchTier,
  type ScoredRow,
} from '../search-ranking.js';
import type {
  ParsedSearchQuery,
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';

const NAME_OR_SKU_KINDS = new Set(['number', 'plate', 'name']);
const SELECT = { id: true, sku: true, name: true } as const;
const ORDER_BY: Prisma.CatalogItemOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];

type PartRow = { id: string; sku: string; name: string };

/** Contains-tier names match word by word ("brake pad" finds "Pad, brake"); exact and prefix match the phrase. */
function nameWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.CatalogItemWhereInput {
  return tier === 'contains'
    ? { AND: query.terms.map((term) => ({ name: tierFilter(tier, term) })) }
    : { name: tierFilter(tier, query.text) };
}

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.CatalogItemWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  if (!NAME_OR_SKU_KINDS.has(query.kind)) return null;
  return {
    OR: [{ sku: tierFilter(tier, query.text) }, nameWhere(query, tier)],
  };
}

function toResult({ row, score }: ScoredRow<PartRow>): SearchResult {
  return {
    type: 'part',
    id: row.id,
    title: row.name,
    subtitle: row.sku,
    href: `/inventory/${row.id}/ledger?sku=${encodeURIComponent(row.sku)}`,
    score,
  };
}

/** The catalog is tenant-wide (ADR-0022), so parts carry no site and are not site-ordered. */
export class PartSearchProvider implements SearchProvider {
  readonly type = 'part';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const isUuid = ctx.query.kind === 'uuid';
    const rows = await collectRanked<PartRow>(
      ctx.limit,
      async (tier) => {
        const match = matchWhere(ctx.query, tier);
        if (!match) return [];
        return this.prisma.catalogItem.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        });
      },
      isUuid ? ['exact'] : undefined,
    );
    return rows.map(toResult);
  }
}
