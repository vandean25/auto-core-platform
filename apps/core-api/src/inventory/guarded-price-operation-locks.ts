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

export async function lockGuardedPriceCatalogItem(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<void> {
  await lockSingleTenantTableRow(tx, 'catalog_items', tenantId, itemId);
}
