import type { Prisma } from '@prisma/client';
import { lockSingleTenantTableRow } from '../purchase/purchase-lock.helpers.js';

type Tx = Prisma.TransactionClient;

type BoundExecuteRaw = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

function boundExecuteRaw(tx: Tx): BoundExecuteRaw {
  const executeRaw = tx['$executeRaw'].bind(tx) as BoundExecuteRaw;
  return executeRaw;
}

export async function setGuardedPriceTxALockTimeout(tx: Tx): Promise<void> {
  await boundExecuteRaw(tx)`SET LOCAL lock_timeout = '5s'`;
}

export async function setGuardedPriceTxELockTimeout(tx: Tx): Promise<void> {
  await boundExecuteRaw(tx)`SET LOCAL lock_timeout = '10s'`;
}

/** ADR-0037 A1: hashtextextended advisory lock after SET LOCAL lock_timeout. */
export async function acquireGuardedPriceAdvisoryLock(
  tx: Tx,
  tenantId: string,
  principalId: string,
  key: string,
): Promise<void> {
  const material = `${tenantId}\u{2016}${principalId}\u{2016}${key}`;
  const executeRaw = boundExecuteRaw(tx);
  await executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${material}::text, 0))`;
}

export async function lockGuardedPriceJournalRow(
  tx: Tx,
  tenantId: string,
  journalId: string,
): Promise<void> {
  await lockSingleTenantTableRow(
    tx,
    'inventory_price_operations',
    tenantId,
    journalId,
  );
}

type BoundQueryRaw<T> = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T>;

function boundQueryRaw<T>(tx: Tx): BoundQueryRaw<T> {
  const queryRaw = tx['$queryRaw'].bind(tx) as BoundQueryRaw<T>;
  return queryRaw;
}

export async function lockGuardedPriceCatalogItem(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<void> {
  await lockSingleTenantTableRow(tx, 'catalog_items', tenantId, itemId);
}

export async function selectAndLockStaleAcceptedPriceOperations(
  tx: Tx,
  tenantId: string,
  cutoff: Date,
  limit: number,
): Promise<Array<{ id: string }>> {
  return boundQueryRaw<Array<{ id: string }>>(tx)`
    SELECT id
    FROM inventory_price_operations
    WHERE tenant_id = ${tenantId}
      AND state = 'ACCEPTED'::"InventoryPriceOperationState"
      AND accepted_at < ${cutoff}
    ORDER BY accepted_at ASC, id ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `;
}
