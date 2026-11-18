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
  estimate_number: true,
  site_id: true,
  workshop_order_id: true,
  workshop_order: {
    select: {
      order_number: true,
      customer: {
        select: { first_name: true, last_name: true, company_name: true },
      },
      vehicle: { select: { plate: true } },
    },
  },
} as const;
const ORDER_BY: Prisma.WorkshopEstimateOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

type EstimateRow = {
  id: string;
  estimate_number: string;
  site_id: string;
  workshop_order_id: string;
  workshop_order: {
    order_number: string;
    customer: {
      first_name: string;
      last_name: string;
      company_name: string | null;
    } | null;
    vehicle: { plate: string | null };
  };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.WorkshopEstimateWhereInput | null {
  const or: Prisma.WorkshopEstimateWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ estimate_number: tierFilter(tier, query.text) });
  }
  const vehicle = vehicleMatchWhere(query, tier);
  if (vehicle) {
    or.push({
      workshop_order: {
        tenant_id: tenantId,
        vehicle: { ...vehicle, tenant_id: tenantId },
      },
    });
  }
  const customer = customerMatchWhere(query, tier, false);
  if (customer) {
    or.push({
      workshop_order: {
        tenant_id: tenantId,
        customer: { ...customer, tenant_id: tenantId },
      },
    });
  }
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<EstimateRow>): SearchResult {
  return {
    type: 'estimate',
    id: row.id,
    title: row.estimate_number,
    subtitle: joinParts([
      row.workshop_order.customer
        ? customerLabel(row.workshop_order.customer)
        : null,
      row.workshop_order.vehicle.plate,
      row.workshop_order.order_number,
    ]),
    href: `/workshop/orders/${row.workshop_order_id}`,
    score,
    siteId: row.site_id,
  };
}

export class EstimateSearchProvider implements SearchProvider {
  readonly type = 'estimate';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectSiteRanked<EstimateRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier);
        if (!match) return [];
        return this.prisma.workshopEstimate.findMany({
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
