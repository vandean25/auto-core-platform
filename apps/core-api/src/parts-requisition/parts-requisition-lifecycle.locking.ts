import { Prisma } from '@prisma/client';

export async function lockRequisitionRows(
  tx: Prisma.TransactionClient,
  tableName: 'workshop_tasks' | 'workshop_task_line_items',
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  const sortedIds = [...new Set(ids)].sort();
  if (sortedIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked sorted tenant-qualified row locks preserve reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM ${Prisma.raw(tableName)}
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionTask(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM workshop_tasks
    WHERE tenant_id = ${tenantId} AND id = ${taskId}
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM workshop_task_line_items
    WHERE tenant_id = ${tenantId} AND id = ${lineId}
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionTasks(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskIds: readonly string[],
): Promise<void> {
  await lockRequisitionRows(tx, 'workshop_tasks', tenantId, taskIds);
}

export async function lockRequisitionLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineIds: readonly string[],
): Promise<void> {
  await lockRequisitionRows(tx, 'workshop_task_line_items', tenantId, lineIds);
}

export async function lockRequisitionReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservationIds: readonly string[],
): Promise<void> {
  if (reservationIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM parts_reservations
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join([...reservationIds])})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stockId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM inventory_stocks
    WHERE tenant_id = ${tenantId} AND id = ${stockId}
    ORDER BY id
    FOR UPDATE
  `;
}
