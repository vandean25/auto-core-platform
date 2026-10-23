import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { collectRanked, type ScoredRow } from '../search-ranking.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { joinParts } from './search-format.js';
import { vehicleMatchWhere } from './vehicle-match.js';

const SELECT = {
  id: true,
  make: true,
  model: true,
  plate: true,
  vin: true,
  year: true,
} as const;
const ORDER_BY: Prisma.VehicleOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { id: 'asc' },
];

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  plate: string | null;
  vin: string | null;
  year: number;
};

export function vehicleTitle(row: VehicleRow): string {
  return `${row.make} ${row.model}`.trim();
}

export function vehicleSubtitle(row: VehicleRow): string | null {
  return joinParts([row.plate, row.vin]);
}

function toResult({ row, score }: ScoredRow<VehicleRow>): SearchResult {
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
    const isUuid = ctx.query.kind === 'uuid';
    const rows = await collectRanked<VehicleRow>(
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
            inventory_role: 'CUSTOMER',
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
