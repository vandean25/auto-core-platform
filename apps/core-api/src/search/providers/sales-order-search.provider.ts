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
import { customerMatchWhere } from './customer-match.js';
import { customerLabel, joinParts } from './search-format.js';
import { vehicleMatchWhere } from './vehicle-match.js';

const SELECT = {
  id: true,
  order_number: true,
  site_id: true,
  customer: {
    select: { first_name: true, last_name: true, company_name: true },
  },
  vehicle: { select: { plate: true } },
} as const;
const ORDER_BY: Prisma.SalesOrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

type SalesOrderRow = {
  id: string;
  order_number: string;
  site_id: string | null;
  customer: {
    first_name: string;
    last_name: string;
    company_name: string | null;
  };
  vehicle: { plate: string | null } | null;
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.SalesOrderWhereInput | null {
  const or: Prisma.SalesOrderWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ order_number: tierFilter(tier, query.text) });
  }
  const vehicle = vehicleMatchWhere(query, tier);
  if (vehicle) or.push({ vehicle: { ...vehicle, tenant_id: tenantId } });
  const customer = customerMatchWhere(query, tier, false);
  if (customer) or.push({ customer: { ...customer, tenant_id: tenantId } });
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<SalesOrderRow>): SearchResult {
  return {
    type: 'sales_order',
    id: row.id,
    title: row.order_number,
    subtitle: joinParts([customerLabel(row.customer), row.vehicle?.plate]),
    href: `/sales-orders/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

export class SalesOrderSearchProvider implements SearchProvider {
  readonly type = 'sales_order';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectSiteRanked<SalesOrderRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier);
        if (!match) return [];
        return this.prisma.salesOrder.findMany({
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
