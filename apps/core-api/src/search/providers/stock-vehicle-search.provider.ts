import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { DEALER_INVENTORY_ROLES } from '../../site/site.constants.js';
import { collectMatches, type ScoredRow } from '../search-ranking.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { vehicleMatchWhere } from './vehicle-match.js';
import {
  VEHICLE_SEARCH_ORDER_BY,
  VEHICLE_SEARCH_SELECT,
  vehicleSubtitle,
  vehicleTitle,
  type VehicleSearchRow,
} from './vehicle-search.provider.js';

function toResult({ row, score }: ScoredRow<VehicleSearchRow>): SearchResult {
  return {
    type: 'stock_vehicle',
    id: row.id,
    title: vehicleTitle(row),
    subtitle: vehicleSubtitle(row),
    href: `/vehicle-stock/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

/**
 * Dealer stock lots. Like GET /api/vehicle-stock/:id (ADR-0022) they are visible for the active site only:
 * a lot of another site would open as a 404, so it is not returned.
 */
export class StockVehicleSearchProvider implements SearchProvider {
  readonly type = 'stock_vehicle';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const { activeSiteId, siteIds } = await ctx.getSiteScope();
    if (!activeSiteId || !siteIds.includes(activeSiteId)) return [];
    const rows = await collectMatches<
      VehicleSearchRow,
      Prisma.VehicleWhereInput
    >(
      ctx,
      (tier) => vehicleMatchWhere(ctx.query, tier),
      (match) =>
        this.prisma.vehicle.findMany({
          where: {
            ...match,
            tenant_id: ctx.tenantId,
            site_id: activeSiteId,
            inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
            stock_status: { not: null },
          },
          select: VEHICLE_SEARCH_SELECT,
          orderBy: VEHICLE_SEARCH_ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
