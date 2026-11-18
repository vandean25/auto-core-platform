import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  collectSiteRanked,
  tierFilter,
  tiersFor,
  type MatchTier,
  type ScoredRow,
} from '../search-ranking.js';
import type {
  ParsedSearchQuery,
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';

const SELECT = {
  id: true,
  order_number: true,
  site_id: true,
  vendor: { select: { name: true } },
} as const;
const ORDER_BY: Prisma.PurchaseOrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

type PurchaseOrderRow = {
  id: string;
  order_number: string;
  site_id: string | null;
  vendor: { name: string };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.PurchaseOrderWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  const or: Prisma.PurchaseOrderWhereInput[] = [];
  if (query.kind === 'number') {
    or.push({ order_number: tierFilter(tier, query.text) });
  }
  if (query.kind === 'name' || query.kind === 'plate') {
    or.push({
      vendor: { tenant_id: tenantId, name: tierFilter(tier, query.text) },
    });
  }
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<PurchaseOrderRow>): SearchResult {
  return {
    type: 'purchase_order',
    id: row.id,
    title: row.order_number,
    subtitle: row.vendor.name,
    href: `/purchase-orders/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

export class PurchaseOrderSearchProvider implements SearchProvider {
  readonly type = 'purchase_order';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectSiteRanked<PurchaseOrderRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier);
        if (!match) return [];
        return this.prisma.purchaseOrder.findMany({
          where: {
            ...match,
            tenant_id: ctx.tenantId,
            site_id: { in: siteIds },
          },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        });
      },
      tiersFor(ctx.query),
    );
    return rows.map(toResult);
  }
}
