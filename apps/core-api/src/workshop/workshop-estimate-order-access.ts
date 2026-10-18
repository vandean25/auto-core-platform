import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES } from './workshop-estimate.constants.js';
import {
  ORDER_FOR_ESTIMATE_SELECT,
  type EstimateDbClient,
  type OrderForEstimate,
} from './workshop-estimate-order.select.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import { lockWorkshopRows } from './workshop-task.helpers.js';

export async function findOrderInScope(
  client: EstimateDbClient,
  scope: EstimateScope,
  orderId: string,
): Promise<OrderForEstimate> {
  const order = await client.workshopOrder.findFirst({
    where: { id: orderId, tenant_id: scope.tenantId, site_id: scope.siteId },
    select: ORDER_FOR_ESTIMATE_SELECT,
  });
  if (!order) {
    throw new NotFoundException('Workshop order not found');
  }
  return order;
}

/** Writes only touch orders still in intake or in progress (COMPLETED and INVOICED are closed). */
export async function loadOrderForWrite(
  client: EstimateDbClient,
  scope: EstimateScope,
  orderId: string,
): Promise<OrderForEstimate> {
  const order = await findOrderInScope(client, scope, orderId);
  if (!WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES.includes(order.status)) {
    throw new ConflictException({
      code: 'WORKSHOP_ORDER_NOT_ESTIMATABLE',
      message: `Estimates can only be created or sent while the order is ${WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES.join(' or ')}.`,
    });
  }
  return order;
}

/**
 * Locks the order's task rows with the task-first lock that line edits take,
 * then reads the order again. The lines frozen into a snapshot therefore never
 * come from a line edit that is still committing (same pattern as the invoice path).
 */
export async function loadAndLockOrderForWrite(
  tx: Prisma.TransactionClient,
  scope: EstimateScope,
  orderId: string,
): Promise<OrderForEstimate> {
  const order = await loadOrderForWrite(tx, scope, orderId);
  await lockWorkshopRows({
    tx,
    tableName: 'workshop_tasks',
    tenantId: scope.tenantId,
    ids: order.tasks.map((task) => task.id),
    siteId: scope.siteId,
  });
  return loadOrderForWrite(tx, scope, orderId);
}
