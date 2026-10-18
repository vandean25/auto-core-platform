import type { Prisma } from '@prisma/client';
import type { TyreSetListQueryDto } from './dto/tyre-set-list-query.dto.js';

/** MCP offset cursors and optional vehicle filter extend the REST list query. */
export type TyreSetListQuery = TyreSetListQueryDto & {
  vehicleId?: string;
  skip?: number;
};

export function tyreSetListSkipOffset(
  query: TyreSetListQuery,
  pageSize: number,
): number {
  const page = query.page && query.page > 0 ? query.page : 1;
  if (query.skip !== undefined && query.skip >= 0) {
    return query.skip;
  }
  return (page - 1) * pageSize;
}

export function buildTyreSetListWhere(
  tenantId: string,
  siteId: string,
  query: TyreSetListQuery,
): Prisma.TyreSetWhereInput {
  const where: Prisma.TyreSetWhereInput = {
    tenant_id: tenantId,
    site_id: siteId,
  };
  if (query.customerId) where.customer_id = query.customerId;
  if (query.vehicleId) where.vehicle_id = query.vehicleId;
  if (query.locationId) where.location_id = query.locationId;
  if (query.season) where.season = query.season;
  if (query.status) where.status = query.status;
  if (query.dueFrom || query.dueTo) {
    where.planned_swap_on = {};
    if (query.dueFrom) {
      where.planned_swap_on.gte = new Date(query.dueFrom);
    }
    if (query.dueTo) {
      where.planned_swap_on.lte = new Date(query.dueTo);
    }
  }
  if (query.vehicleSearch) {
    const term = query.vehicleSearch.trim();
    where.vehicle = {
      OR: [
        { plate: { contains: term, mode: 'insensitive' } },
        { vin: { contains: term, mode: 'insensitive' } },
      ],
    };
  }
  return where;
}
