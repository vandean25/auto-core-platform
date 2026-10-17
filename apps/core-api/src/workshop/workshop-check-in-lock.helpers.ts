import type { Prisma, WorkshopCheckInStatus } from '@prisma/client';

export type LockedWorkshopCheckInRow = {
  id: string;
  workshop_order_id: string;
  status: WorkshopCheckInStatus;
  inspection_id: string | null;
};

export async function lockWorkshopOrderForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- Row lock serializes order-level Annahme inspection creation.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM workshop_orders
    WHERE id = ${orderId} AND tenant_id = ${tenantId}
    FOR UPDATE
  `;
  if (!rows[0]) {
    throw new Error('Workshop order not found while locking for check-in');
  }
}

export async function lockWorkshopCheckInForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  checkInId: string,
): Promise<LockedWorkshopCheckInRow | null> {
  // eslint-disable-next-line no-restricted-syntax -- Row lock serializes inspection_id linking on idempotent create.
  const rows = await tx.$queryRaw<LockedWorkshopCheckInRow[]>`
    SELECT id, workshop_order_id, status, inspection_id
    FROM workshop_check_ins
    WHERE id = ${checkInId} AND tenant_id = ${tenantId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
