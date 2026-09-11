import { Prisma } from '@prisma/client';

/**
 * Global lock order for purchase order operations (must match the BE-9 Release path):
 * 1. workshop_tasks (ORDER BY id ASC)
 * 2. workshop_task_line_items (ORDER BY id ASC)
 * 3. parts_reservations (linked slices, ORDER BY id ASC)  ← before PO rows
 * 4. purchase_orders (PO headers)
 * 5. purchase_order_items (PO lines, ORDER BY id ASC)
 *
 * parts_reservations are locked before the PO header so that receive and the
 * upcoming BE-9 Release path (which locks reservations first) share the same
 * acquisition order and cannot deadlock each other.
 *
 * All row locks are strictly tenant-qualified and executed inside the calling
 * transaction.
 */

async function lockTenantRows(
  tx: Prisma.TransactionClient,
  tableName: string,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  const sortedIds = [...new Set(ids)].sort();
  if (sortedIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked sorted tenant-qualified row locks preserve the global lock order.
  await tx.$queryRaw`
    SELECT id
    FROM ${Prisma.raw(tableName)}
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockWorkshopTasks(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskIds: readonly string[],
): Promise<void> {
  await lockTenantRows(tx, 'workshop_tasks', tenantId, taskIds);
}

export async function lockWorkshopTaskLineItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineIds: readonly string[],
): Promise<void> {
  await lockTenantRows(tx, 'workshop_task_line_items', tenantId, lineIds);
}

export async function lockPurchaseOrderHeader(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<void> {
  await lockTenantRows(tx, 'purchase_orders', tenantId, [orderId]);
}

export async function lockPurchaseOrderItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemIds: readonly string[],
): Promise<void> {
  await lockTenantRows(tx, 'purchase_order_items', tenantId, itemIds);
}

export async function lockPartsReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservationIds: readonly string[],
): Promise<void> {
  await lockTenantRows(tx, 'parts_reservations', tenantId, reservationIds);
}
