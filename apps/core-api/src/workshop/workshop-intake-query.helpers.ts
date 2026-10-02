import { NotFoundException } from '@nestjs/common';
import {
  LoanerBookingStatus,
  Prisma,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  normalizeWorkshopOrder,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';

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
  loaner_bookings: {
    where: {
      status: {
        in: [LoanerBookingStatus.RESERVED, LoanerBookingStatus.HANDED_OVER],
      },
    },
    orderBy: [{ handed_over_at: 'desc' }, { planned_from: 'desc' }],
    take: 1,
    include: {
      loaner_vehicle: {
        include: {
          vehicle: { select: { make: true, model: true, plate: true } },
        },
      },
    },
  },
  tasks: {
    orderBy: { createdAt: 'asc' },
    include: {
      line_items: true,
    },
  },
} satisfies Prisma.WorkshopOrderInclude;

export interface FindAllPagination {
  page: number;
  pageSize: number;
  skip: number;
}

export interface FindAllWorkshopOrdersParams {
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  customerId?: string;
}

export function resolveFindAllPagination(
  page?: number,
  pageSize?: number,
): FindAllPagination {
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
  switch (sortField) {
    case 'status':
      return { status: sortDirection };
    case 'orderNo':
    case 'order_number':
      return { order_number: sortDirection };
    case 'id':
      return { id: sortDirection };
    case 'customer':
      return { customer: { last_name: sortDirection } };
    case 'vehicle':
      return { vehicle: { make: sortDirection } };
    default:
      return { createdAt: sortDirection };
  }
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
      { make: { contains: query, mode: 'insensitive' } },
      { model: { contains: query, mode: 'insensitive' } },
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

export async function findLiveOrderForVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  vehicleId: string,
) {
  return tx.workshopOrder.findFirst({
    where: {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: vehicleId,
      status: { in: LIVE_ORDER_STATUSES },
    },
    select: { id: true, order_number: true },
  });
}

export async function executeFindAllWorkshopOrders(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  params: FindAllWorkshopOrdersParams,
) {
  const { page, pageSize, skip } = resolveFindAllPagination(
    params.page,
    params.pageSize,
  );
  const where = buildWorkshopOrderFindAllWhere(tenantId, siteId, params.search);
  const orderBy = buildWorkshopOrderOrderBy(
    params.sortField,
    params.sortDirection,
  );
  const scopedWhere: Prisma.WorkshopOrderWhereInput = {
    ...where,
    site_id: siteId,
    ...(params.customerId
      ? {
          customer_id: params.customerId,
          status: { in: LIVE_ORDER_STATUSES },
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.workshopOrder.findMany({
      where: scopedWhere,
      include: ORDER_WITH_RELATIONS,
      skip,
      take: pageSize,
      orderBy,
    }),
    prisma.workshopOrder.count({ where: scopedWhere }),
  ]);

  return {
    data: data.map((order) =>
      normalizeWorkshopOrder(order as WorkshopOrderWithRelations),
    ),
    meta: {
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    },
  };
}

export async function executeFindOneWorkshopOrder(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  id: string,
) {
  const order = await prisma.workshopOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });

  if (!order) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }

  return normalizeWorkshopOrder(order);
}

export async function executeSearchWorkshop(
  prisma: PrismaService,
  tenantId: string,
  query: string,
) {
  const page = 1;
  const limit = SEARCH_LIMIT;
  const skip = (page - 1) * limit;

  const vehicleWhere = buildVehicleSearchWhere(tenantId, query);
  const customerWhere = buildCustomerSearchWhere(tenantId, query);

  const [vehicles, customers, vehicleTotal, customerTotal] = await Promise.all([
    prisma.vehicle.findMany({
      where: vehicleWhere,
      include: {
        customer: true,
      },
      skip,
      take: limit,
    }),
    prisma.customer.findMany({
      where: customerWhere,
      include: {
        vehicles: true,
      },
      skip,
      take: limit,
    }),
    prisma.vehicle.count({ where: vehicleWhere }),
    prisma.customer.count({ where: customerWhere }),
  ]);

  const total = vehicleTotal + customerTotal;

  return {
    data: {
      vehicles: vehicles.map(stripVehicleIdentityResolutionState),
      customers: customers.map((customer) => ({
        ...customer,
        vehicles: customer.vehicles?.map(stripVehicleIdentityResolutionState),
      })),
    },
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
