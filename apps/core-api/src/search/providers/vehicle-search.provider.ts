import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { collectMatches, type ScoredRow } from '../search-ranking.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { joinParts } from './search-format.js';
import { vehicleMatchWhere } from './vehicle-match.js';

export const VEHICLE_SEARCH_SELECT = {
  id: true,
  make: true,
  model: true,
  plate: true,
  vin: true,
  site_id: true,
} as const;
export const VEHICLE_SEARCH_ORDER_BY: Prisma.VehicleOrderByWithRelationInput[] =
  [{ updatedAt: 'desc' }, { id: 'asc' }];

export type VehicleSearchRow = {
  id: string;
  make: string;
  model: string;
  plate: string | null;
  vin: string | null;
  site_id: string | null;
};

export function vehicleTitle(row: VehicleSearchRow): string {
  return `${row.make} ${row.model}`.trim();
}

export function vehicleSubtitle(row: VehicleSearchRow): string | null {
  return joinParts([row.plate, row.vin]);
}

function toResult({ row, score }: ScoredRow<VehicleSearchRow>): SearchResult {
  return {
    type: 'vehicle',
    id: row.id,
    title: vehicleTitle(row),
    subtitle: vehicleSubtitle(row),
    href: `/vehicles/${row.id}`,
    score,
  };
}

/** CRM vehicle identity is tenant-wide (ADR-0022); dealer stock lots are a separate type. */
export class VehicleSearchProvider implements SearchProvider {
  readonly type = 'vehicle';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
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
            inventory_role: 'CUSTOMER',
          },
          select: VEHICLE_SEARCH_SELECT,
          orderBy: VEHICLE_SEARCH_ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
