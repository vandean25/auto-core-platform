import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../../common/utils/status-transition';
import type { CreateSalesOrderItemDto } from '../sales-order/dto/create-sales-order.dto';
import { assertCatalogItemsBelongToTenant } from './sales-tenant-validation.helpers';

export const SALES_ORDER_NEXT_STATUS: Record<
  SalesOrderStatus,
  SalesOrderStatus[]
> = {
  [SalesOrderStatus.DRAFT]: [SalesOrderStatus.CONFIRMED],
  [SalesOrderStatus.CONFIRMED]: [SalesOrderStatus.IN_PROGRESS],
  [SalesOrderStatus.IN_PROGRESS]: [SalesOrderStatus.COMPLETED],
  [SalesOrderStatus.COMPLETED]: [SalesOrderStatus.INVOICED],
  [SalesOrderStatus.INVOICED]: [],
};

export type SalesOrderItemCreateData = {
  tenant_id: string;
  catalog_item_id: string;
  description: string;
  quantity: Prisma.Decimal;
  unit_price: Prisma.Decimal;
  tax_rate: Prisma.Decimal;
  total: Prisma.Decimal;
};

export function assertSalesOrderStatusTransition(
  currentStatus: SalesOrderStatus,
  nextStatus: SalesOrderStatus,
): void {
  const allowed = SALES_ORDER_NEXT_STATUS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new BadRequestException(
      `Cannot transition sales order from ${currentStatus} to ${nextStatus}`,
    );
  }
}

export function formatSalesOrderItem(
  tenantId: string,
  item: CreateSalesOrderItemDto,
): SalesOrderItemCreateData {
  const quantity = new Prisma.Decimal(item.quantity);
  const unitPrice = new Prisma.Decimal(item.unit_price);
  const total = quantity.mul(unitPrice);
  return {
    tenant_id: tenantId,
    catalog_item_id: item.catalog_item_id as string,
    description: item.description,
    quantity,
    unit_price: unitPrice,
    tax_rate: new Prisma.Decimal(item.tax_rate || 20),
    total,
  };
}

export function sumSalesOrderItemTotals(
  items: SalesOrderItemCreateData[],
): Prisma.Decimal {
  return items.reduce(
    (sum, item) => sum.add(item.total),
    new Prisma.Decimal(0),
  );
}

export async function prepareReplacementItems(
  prisma: Pick<PrismaService, 'catalogItem'>,
  tenantId: string,
  replacementItems: CreateSalesOrderItemDto[],
): Promise<{ items: SalesOrderItemCreateData[]; totalAmount: Prisma.Decimal }> {
  const catalogItemIds = replacementItems
    .map((item) => item.catalog_item_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (catalogItemIds.length !== replacementItems.length) {
    throw new BadRequestException(
      'Each sales order item must include catalog_item_id',
    );
  }

  await assertCatalogItemsBelongToTenant(prisma, catalogItemIds, tenantId);

  const items = replacementItems.map((item) =>
    formatSalesOrderItem(tenantId, item),
  );

  return { items, totalAmount: sumSalesOrderItemTotals(items) };
}

export async function reconcileSalesOrderItems(
  tx: Prisma.TransactionClient,
  params: {
    salesOrderId: string;
    tenantId: string;
    items: SalesOrderItemCreateData[];
  },
): Promise<void> {
  await tx.salesOrderItem.deleteMany({
    where: {
      sales_order_id: params.salesOrderId,
      tenant_id: params.tenantId,
    },
  });
  await tx.salesOrderItem.createMany({
    data: params.items.map((item) => ({
      ...item,
      sales_order_id: params.salesOrderId,
    })),
  });
}

export async function persistSalesOrderUpdate(
  tx: Prisma.TransactionClient,
  params: {
    id: string;
    tenantId: string;
    currentStatus: SalesOrderStatus;
    nextStatus?: SalesOrderStatus;
    fieldData: Prisma.SalesOrderUncheckedUpdateManyInput;
  },
): Promise<void> {
  const statusChanging =
    params.nextStatus !== undefined &&
    params.nextStatus !== params.currentStatus;

  if (statusChanging) {
    await guardedStatusUpdate(bindStatusUpdateMany(tx.salesOrder), {
      id: params.id,
      tenantId: params.tenantId,
      from: params.currentStatus,
      to: params.nextStatus!,
      extraData: params.fieldData,
      conflictMessage:
        'Sales order status changed concurrently. Please refresh and try again.',
    });
    return;
  }

  const updateResult = await tx.salesOrder.updateMany({
    where: { id: params.id, tenant_id: params.tenantId },
    data: params.fieldData,
  });

  if (updateResult.count === 0) {
    throw new NotFoundException('Sales order not found');
  }
}
