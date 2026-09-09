import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../../common/utils/status-transition';

const INVOICEABLE_SALES_ORDER_STATUSES = new Set<SalesOrderStatus>([
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.IN_PROGRESS,
  SalesOrderStatus.COMPLETED,
]);

export async function transitionLinkedSalesOrderToInvoiced(
  tx: Prisma.TransactionClient,
  tenantId: string,
  salesOrderId: string,
): Promise<void> {
  const salesOrder = await tx.salesOrder.findFirst({
    where: { id: salesOrderId },
    select: { status: true },
  });

  if (!salesOrder) {
    throw new NotFoundException('Sales order not found');
  }

  if (!INVOICEABLE_SALES_ORDER_STATUSES.has(salesOrder.status)) {
    throw new BadRequestException(
      'Sales order must be CONFIRMED, IN_PROGRESS, or COMPLETED to be invoiced',
    );
  }

  await guardedStatusUpdate(bindStatusUpdateMany(tx.salesOrder), {
    id: salesOrderId,
    tenantId,
    from: salesOrder.status,
    to: SalesOrderStatus.INVOICED,
    conflictMessage:
      'Sales order status changed concurrently. Please refresh and try again.',
  });
}
