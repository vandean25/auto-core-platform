import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../../common/utils/status-transition.js';

export const INVOICEABLE_SALES_ORDER_STATUSES = new Set<SalesOrderStatus>([
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.IN_PROGRESS,
  SalesOrderStatus.COMPLETED,
]);

const SALES_ORDER_INVOICE_ELIGIBILITY_MESSAGE =
  'Sales order must be CONFIRMED, IN_PROGRESS, or COMPLETED to be invoiced';

export async function ensureSalesOrderInvoiceable(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  salesOrderId: string,
): Promise<SalesOrderStatus> {
  const salesOrder = await tx.salesOrder.findFirst({
    where: { id: salesOrderId, tenant_id: tenantId, site_id: siteId },
    select: { status: true },
  });

  if (!salesOrder) {
    throw new NotFoundException('Sales order not found');
  }

  if (INVOICEABLE_SALES_ORDER_STATUSES.has(salesOrder.status)) {
    return salesOrder.status;
  }

  if (salesOrder.status === SalesOrderStatus.DRAFT) {
    await guardedStatusUpdate(bindStatusUpdateMany(tx.salesOrder), {
      id: salesOrderId,
      tenantId,
      from: SalesOrderStatus.DRAFT,
      to: SalesOrderStatus.CONFIRMED,
      extraWhere: { site_id: siteId },
      conflictMessage:
        'Sales order status changed concurrently. Please refresh and try again.',
    });
    return SalesOrderStatus.CONFIRMED;
  }

  throw new BadRequestException(SALES_ORDER_INVOICE_ELIGIBILITY_MESSAGE);
}

export async function transitionLinkedSalesOrderToInvoiced(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  salesOrderId: string,
): Promise<void> {
  const statusBeforeInvoiced = await ensureSalesOrderInvoiceable(
    tx,
    tenantId,
    siteId,
    salesOrderId,
  );

  await guardedStatusUpdate(bindStatusUpdateMany(tx.salesOrder), {
    id: salesOrderId,
    tenantId,
    from: statusBeforeInvoiced,
    to: SalesOrderStatus.INVOICED,
    extraWhere: { site_id: siteId },
    conflictMessage:
      'Sales order status changed concurrently. Please refresh and try again.',
  });
}
