import { ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { extractCustomFieldMappings } from './import-custom-fields.util.js';
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

function initCustomFieldCounts(
  mapping?: Record<string, string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!mapping) {
    return counts;
  }
  for (const { key } of extractCustomFieldMappings(mapping)) {
    counts[key] = 0;
  }
  return counts;
}

function accumulateRowCustomFieldCounts(
  row: DryRunTotalsRow,
  counts: Record<string, number>,
): void {
  if (
    row.action !== ImportRowAction.CREATE &&
    row.action !== ImportRowAction.UPDATE
  ) {
    return;
  }
  const cf = row.normalized?.custom_fields;
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) {
    return;
  }
  for (const [key, val] of Object.entries(cf as Record<string, unknown>)) {
    if (val !== null && val !== undefined && val !== '') {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
}

/** Totals of a dry run, including how many rows carry a price jump or mapped custom fields. */
export function computeDryRunTotals(
  rows: DryRunTotalsRow[],
  mapping?: Record<string, string>,
): ImportJobTotals {
  const customFieldCounts = initCustomFieldCounts(mapping);
  const totals: ImportJobTotals = {
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
      totals.flagged_jumps = (totals.flagged_jumps ?? 0) + 1;
    }
    accumulateRowCustomFieldCounts(row, customFieldCounts);
  }
  if (Object.keys(customFieldCounts).length > 0) {
    totals.custom_field_counts = customFieldCounts;
  }
  return totals;
}

/** Zeroed totals for an apply run over `rowCount` rows. */
export function createApplyTotals(
  rowCount: number,
  customFieldCounts?: Record<string, number>,
): ImportJobTotals {
  return {
    rows: rowCount,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
    ...(customFieldCounts ? { custom_field_counts: customFieldCounts } : {}),
  };
}

/** Seeds apply totals for a resumed batch from stored job totals. */
export function createResumedApplyTotals(
  rowCount: number,
  storedTotals: ImportJobTotals | null | undefined,
): ImportJobTotals {
  const totals = createApplyTotals(
    Math.max(rowCount, storedTotals?.rows ?? 0),
    storedTotals?.custom_field_counts,
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

export type ImportApplyRowTally = 'skip' | 'error' | 'written' | 'noop';

/** Returns apply totals after one background row outcome (does not mutate `totals`). */
export function importTotalsAfterApplyRowTally(
  totals: ImportJobTotals,
  action: ImportRowAction,
  tally: ImportApplyRowTally,
): ImportJobTotals {
  const next = { ...totals };
  if (tally === 'skip') {
    next.skip += 1;
  } else if (tally === 'error') {
    next.error += 1;
  } else if (tally === 'written') {
    tallyWrittenRow(next, action);
  } else if (tally === 'noop') {
    tallyWrittenRow(next, action);
  }
  return next;
}
