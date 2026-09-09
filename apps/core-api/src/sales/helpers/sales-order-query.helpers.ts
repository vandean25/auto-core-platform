import { Prisma, SalesOrderStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { stripVehicleIdentityResolutionState } from '../../vehicle/vehicle-identity.util';

export type SalesOrderWithRelations = Prisma.SalesOrderGetPayload<{
  include: { customer: true; vehicle: true; items: true };
}>;

export type PublicSalesOrder = Omit<SalesOrderWithRelations, 'vehicle'> & {
  vehicle: Omit<
    NonNullable<SalesOrderWithRelations['vehicle']>,
    'identity_resolution_generation' | 'identity_resolution_token'
  > | null;
};

const SALES_ORDER_LIST_INCLUDE = {
  customer: true,
  vehicle: true,
  items: true,
} as const;

export function isSalesOrderFindManyArgs(
  params?: Prisma.SalesOrderFindManyArgs | SalesOrderStatus,
): params is Prisma.SalesOrderFindManyArgs {
  return (
    typeof params === 'object' &&
    params !== null &&
    ('where' in params || 'orderBy' in params || 'skip' in params)
  );
}

export function toPublicSalesOrder(
  order: SalesOrderWithRelations,
): PublicSalesOrder {
  return {
    ...order,
    vehicle: order.vehicle
      ? stripVehicleIdentityResolutionState(order.vehicle)
      : order.vehicle,
  };
}

export async function findPaginatedSalesOrders(
  prisma: Pick<PrismaService, 'salesOrder'>,
  tenantId: string,
  params: Prisma.SalesOrderFindManyArgs,
): Promise<{ data: PublicSalesOrder[]; total: number }> {
  const scopedWhere = { ...(params.where ?? {}), tenant_id: tenantId };
  const [data, total] = await Promise.all([
    prisma.salesOrder.findMany({
      ...params,
      where: scopedWhere,
      include: SALES_ORDER_LIST_INCLUDE,
    }),
    prisma.salesOrder.count({ where: scopedWhere }),
  ]);

  return {
    data: data.map(toPublicSalesOrder),
    total,
  };
}

export async function findDefaultSalesOrders(
  prisma: Pick<PrismaService, 'salesOrder'>,
  tenantId: string,
  status?: SalesOrderStatus,
): Promise<{ data: PublicSalesOrder[]; total: number }> {
  const where: Prisma.SalesOrderWhereInput = { tenant_id: tenantId };
  if (status) {
    where.status = status;
  }

  const data = await prisma.salesOrder.findMany({
    where,
    include: SALES_ORDER_LIST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return {
    data: data.map(toPublicSalesOrder),
    total: data.length,
  };
}
