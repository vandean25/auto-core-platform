import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { DEALER_INVENTORY_ROLES } from '../../site/site.constants.js';
import { collectRanked, type ScoredRow } from '../search-ranking.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { vehicleMatchWhere } from './vehicle-match.js';
import { vehicleSubtitle, vehicleTitle } from './vehicle-search.provider.js';

const SELECT = {
  id: true,
  make: true,
  model: true,
  plate: true,
  vin: true,
  year: true,
  site_id: true,
} as const;
const ORDER_BY: Prisma.VehicleOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { id: 'asc' },
];

type StockVehicleRow = {
  id: string;
  make: string;
  model: string;
  plate: string | null;
  vin: string | null;
  year: number;
  site_id: string | null;
};

function toResult({ row, score }: ScoredRow<StockVehicleRow>): SearchResult {
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
  readonly siteScoped = true;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const siteId = ctx.siteScope.activeSiteId;
    if (!siteId || !ctx.siteScope.siteIds.includes(siteId)) return [];
    const isUuid = ctx.query.kind === 'uuid';
    const rows = await collectRanked<StockVehicleRow>(
      ctx.limit,
      async (tier) => {
        const match = isUuid
          ? { id: ctx.query.text.toLowerCase() }
          : vehicleMatchWhere(ctx.query, tier);
        if (!match) return [];
        return this.prisma.vehicle.findMany({
          where: {
            ...match,
            tenant_id: ctx.tenantId,
            site_id: siteId,
            inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
            stock_status: { not: null },
          },
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
