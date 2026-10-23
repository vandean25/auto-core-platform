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
  vehicle: { select: { make: true, model: true, plate: true } },
} as const;
const ORDER_BY: Prisma.WorkshopOrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

type WorkshopOrderRow = {
  id: string;
  order_number: string;
  site_id: string | null;
  customer: {
    first_name: string;
    last_name: string;
    company_name: string | null;
  } | null;
  vehicle: { make: string; model: string; plate: string | null };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
  restricted: boolean,
): Prisma.WorkshopOrderWhereInput | null {
  const or: Prisma.WorkshopOrderWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ order_number: tierFilter(tier, query.text) });
  }
  const vehicle = vehicleMatchWhere(query, tier);
  if (vehicle) or.push({ vehicle: { ...vehicle, tenant_id: tenantId } });
  const customer = customerMatchWhere(query, tier, restricted);
  if (customer) or.push({ customer: { ...customer, tenant_id: tenantId } });
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<WorkshopOrderRow>): SearchResult {
  const vehicle = `${row.vehicle.make} ${row.vehicle.model}`.trim();
  return {
    type: 'workshop_order',
    id: row.id,
    title: row.order_number,
    subtitle: joinParts([
      row.customer ? customerLabel(row.customer) : null,
      vehicle,
      row.vehicle.plate,
    ]),
    href: `/workshop/orders/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

export class WorkshopOrderSearchProvider implements SearchProvider {
  readonly type = 'workshop_order';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const restricted = ctx.role === 'TECH';
    const rows = await collectSiteRanked<WorkshopOrderRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier, restricted);
        if (!match) return [];
        return this.prisma.workshopOrder.findMany({
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
