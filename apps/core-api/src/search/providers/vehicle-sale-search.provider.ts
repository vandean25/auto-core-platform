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
  sale_number: true,
  site_id: true,
  customer: {
    select: { first_name: true, last_name: true, company_name: true },
  },
  vehicle: { select: { make: true, model: true, plate: true } },
} as const;
const ORDER_BY: Prisma.VehicleSaleOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

type VehicleSaleRow = {
  id: string;
  sale_number: string;
  site_id: string | null;
  customer: {
    first_name: string;
    last_name: string;
    company_name: string | null;
  };
  vehicle: { make: string; model: string; plate: string | null };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.VehicleSaleWhereInput | null {
  const or: Prisma.VehicleSaleWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ sale_number: tierFilter(tier, query.text) });
  }
  const vehicle = vehicleMatchWhere(query, tier);
  if (vehicle) or.push({ vehicle: { ...vehicle, tenant_id: tenantId } });
  const customer = customerMatchWhere(query, tier, false);
  if (customer) or.push({ customer: { ...customer, tenant_id: tenantId } });
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<VehicleSaleRow>): SearchResult {
  const vehicle = `${row.vehicle.make} ${row.vehicle.model}`.trim();
  return {
    type: 'vehicle_sale',
    id: row.id,
    title: row.sale_number,
    subtitle: joinParts([
      customerLabel(row.customer),
      vehicle,
      row.vehicle.plate,
    ]),
    href: `/vehicle-stock/sales/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

export class VehicleSaleSearchProvider implements SearchProvider {
  readonly type = 'vehicle_sale';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectSiteRanked<VehicleSaleRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier);
        if (!match) return [];
        return this.prisma.vehicleSale.findMany({
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
