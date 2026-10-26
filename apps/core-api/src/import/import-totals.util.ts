import { ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportJobTotals } from './import.types.js';

type DryRunTotalsRow = {
  action: ImportRowAction;
  normalized?: Record<string, unknown> | null;
  warnings?: Array<{ code?: string }>;
};

function isPriceJumpFlagged(row: DryRunTotalsRow): boolean {
  return (
    row.normalized?.price_jump_flagged === true ||
    Boolean(
      row.warnings?.some(
        (warning) => warning.code === IMPORT_ERROR_CODES.PRICE_JUMP_EXCEEDED,
      ),
    )
  );
}

function countAction(totals: ImportJobTotals, action: ImportRowAction): void {
  if (action === ImportRowAction.CREATE) totals.create += 1;
  else if (action === ImportRowAction.UPDATE) totals.update += 1;
  else if (action === ImportRowAction.SKIP) totals.skip += 1;
  else if (action === ImportRowAction.ERROR) totals.error += 1;
}

/** Totals of a dry run, including how many rows carry a price jump. */
export function computeDryRunTotals(rows: DryRunTotalsRow[]): ImportJobTotals {
  const totals = {
    rows: 0,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
    flagged_jumps: 0,
  };
  for (const row of rows) {
    totals.rows += 1;
    countAction(totals, row.action);
    if (isPriceJumpFlagged(row)) {
      totals.flagged_jumps += 1;
    }
  }
  return totals;
}

/** Zeroed totals for an apply run over `rowCount` rows. */
export function createApplyTotals(rowCount: number): ImportJobTotals {
  return { rows: rowCount, create: 0, update: 0, skip: 0, error: 0 };
}

/** Seeds apply totals for a resumed batch from stored job totals. */
export function createResumedApplyTotals(
  rowCount: number,
  storedTotals: ImportJobTotals | null | undefined,
): ImportJobTotals {
  const totals = createApplyTotals(
    Math.max(rowCount, storedTotals?.rows ?? 0),
  );
  if (!storedTotals) {
    return totals;
  }
  totals.create = storedTotals.create ?? 0;
  totals.update = storedTotals.update ?? 0;
  totals.skip = storedTotals.skip ?? 0;
  totals.error = storedTotals.error ?? 0;
  return totals;
}

/** Counts a row that was written as CREATE or UPDATE. Other outcomes are not tallied here. */
export function tallyWrittenRow(
  totals: ImportJobTotals,
  action: ImportRowAction,
): void {
  if (action === ImportRowAction.CREATE) totals.create += 1;
  else if (action === ImportRowAction.UPDATE) totals.update += 1;
}
