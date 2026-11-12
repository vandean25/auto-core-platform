import {
  collectDbStatements,
  type CapturedStatement,
} from './db-statement-counter.js';

const BEGIN = /^\s*BEGIN\b/i;
const COMMIT = /^\s*COMMIT\b/i;
const ROLLBACK = /^\s*ROLLBACK\b/i;
const STOCK_TRANSFER_TABLE = /\bstock_transfer/i;

/**
 * Returns BEGIN through COMMIT of the first committed transaction that touched a stock_transfer table,
 * taken from that transaction's own connection only. The pg spy is process-wide, so statements other
 * work in the same Jest process sends on other connections (another suite's transaction, background
 * jobs) never enter the count, whatever table they touch or when they BEGIN.
 */
export function stockTransferTransactionStatements(
  captured: CapturedStatement[],
): string[] {
  const open = new Map<unknown, string[]>();
  for (const { sql, connection } of captured) {
    if (BEGIN.test(sql)) {
      open.set(connection, [sql]);
      continue;
    }
    const transaction = open.get(connection);
    if (!transaction) {
      continue;
    }
    if (ROLLBACK.test(sql)) {
      open.delete(connection);
      continue;
    }
    transaction.push(sql);
    if (COMMIT.test(sql)) {
      open.delete(connection);
      if (
        transaction.some((statement) => STOCK_TRANSFER_TABLE.test(statement))
      ) {
        return transaction;
      }
    }
  }
  throw new Error('No committed stock_transfer transaction was captured.');
}

/** Counts the statements of the stock-transfer transaction that `run` commits (see above). */
export async function countStockTransferActionStatements(
  run: () => Promise<unknown>,
): Promise<number> {
  return stockTransferTransactionStatements(await collectDbStatements(run))
    .length;
}
