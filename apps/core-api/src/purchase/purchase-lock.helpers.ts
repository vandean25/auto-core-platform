import { Prisma } from '@prisma/client';

/**
 * Global lock order for purchase order operations:
 * 1. purchase_orders (PO header)
 * 2. purchase_order_items (PO lines, ORDER BY id ASC)
 * 3. parts_reservations (linked slices, ORDER BY id ASC)
 *
 * All row locks are strictly tenant-qualified and executed inside the calling transaction.
 */

export async function lockPurchaseOrderHeader(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves global PO lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM purchase_orders
    WHERE tenant_id = ${tenantId} AND id = ${orderId}
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockPurchaseOrderItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemIds: readonly string[],
): Promise<void> {
  const sortedIds = [...new Set(itemIds)].sort();
  if (sortedIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked sorted tenant-qualified row locks preserve global PO lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM purchase_order_items
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockPartsReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservationIds: readonly string[],
): Promise<void> {
  const sortedIds = [...new Set(reservationIds)].sort();
  if (sortedIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked sorted tenant-qualified row locks preserve global PO lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM parts_reservations
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}
