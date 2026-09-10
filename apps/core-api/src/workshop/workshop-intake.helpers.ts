import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  VehicleInventoryRole,
  VehicleStockStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_LIMIT = 100;

export const LIVE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

export const ORDER_WITH_RELATIONS = {
  customer: true,
  vehicle: true,
  tasks: {
    include: {
      line_items: true,
    },
  },
} as const;

export const ORDER_WITH_INVOICE_RELATIONS = {
  customer: true,
  vehicle: true,
  invoice: { select: { id: true, invoice_number: true } },
  tasks: {
    orderBy: { createdAt: 'asc' },
    include: {
      line_items: true,
    },
  },
} as const;

export function resolveFindAllPagination(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; skip: number } {
  const resolvedPage = page && page > 0 ? page : 1;
  const rawSize = pageSize && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  const resolvedPageSize = Math.min(rawSize, MAX_PAGE_SIZE);
  const skip = (resolvedPage - 1) * resolvedPageSize;

  return {
    page: resolvedPage,
    pageSize: resolvedPageSize,
    skip,
  };
}

export function buildWorkshopOrderFindAllWhere(
  tenantId: string,
  siteId: string,
  search?: string,
): Prisma.WorkshopOrderWhereInput {
  if (!search) {
    return { tenant_id: tenantId, site_id: siteId };
  }

  return {
    tenant_id: tenantId,
    site_id: siteId,
    OR: [
      {
        order_number: { contains: search, mode: 'insensitive' },
      },
      { id: { contains: search, mode: 'insensitive' } },
      {
        customer: {
          OR: [
            {
              first_name: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              last_name: { contains: search, mode: 'insensitive' },
            },
            {
              company_name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          ],
        },
      },
      {
        vehicle: {
          OR: [
            { make: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { plate: { contains: search, mode: 'insensitive' } },
            { vin: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
    ],
  };
}

export function buildWorkshopOrderOrderBy(
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'desc',
): Prisma.WorkshopOrderOrderByWithRelationInput {
  const resolvedField = sortField ?? 'createdAt';

  if (resolvedField === 'status') {
    return { status: sortDirection };
  }
  if (resolvedField === 'orderNo' || resolvedField === 'order_number') {
    return { order_number: sortDirection };
  }
  if (resolvedField === 'id') {
    return { id: sortDirection };
  }
  if (resolvedField === 'customer') {
    return { customer: { last_name: sortDirection } };
  }
  if (resolvedField === 'vehicle') {
    return { vehicle: { make: sortDirection } };
  }

  return { createdAt: sortDirection };
}

export function buildVehicleSearchWhere(
  tenantId: string,
  query: string,
): Prisma.VehicleWhereInput {
  return {
    tenant_id: tenantId,
    OR: [
      { vin: { contains: query, mode: 'insensitive' } },
      { plate: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export function buildCustomerSearchWhere(
  tenantId: string,
  query: string,
): Prisma.CustomerWhereInput {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      query,
    );

  return {
    tenant_id: tenantId,
    OR: [
      ...(isUuid ? [{ id: { equals: query } }] : []),
      { first_name: { contains: query, mode: 'insensitive' } },
      { last_name: { contains: query, mode: 'insensitive' } },
      { company_name: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export function pickClosestScheduledOrder<
  T extends { id: string; scheduled_start_at: Date | null },
>(orders: T[]): T {
  const now = Date.now();
  return [...orders].sort((left, right) => {
    const leftStart = left.scheduled_start_at?.getTime();
    const rightStart = right.scheduled_start_at?.getTime();
    if (leftStart == null && rightStart == null) return 0;
    if (leftStart == null) return 1;
    if (rightStart == null) return -1;
    return (
      Math.abs(leftStart - now) - Math.abs(rightStart - now) ||
      leftStart - rightStart
    );
  })[0];
}

export function validateCreateOrderInput(
  dto: CreateWorkshopOrderDto,
  isScheduled: boolean,
): void {
  if (
    !isScheduled &&
    (dto.odometer === undefined || dto.fuelLevel === undefined)
  ) {
    throw new BadRequestException('odometer and fuelLevel are required');
  }
}

export function validateStockPrepVehicle(vehicle: {
  inventory_role?: VehicleInventoryRole | null;
  stock_status?: VehicleStockStatus | null;
}): void {
  if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
    throw new BadRequestException(
      'Stock prep requires a used dealer-stock vehicle',
    );
  }
  if (
    vehicle.stock_status !== VehicleStockStatus.IN_STOCK &&
    vehicle.stock_status !== VehicleStockStatus.RESERVED
  ) {
    throw new BadRequestException(
      'Stock prep requires the vehicle to be in stock',
    );
  }
}
