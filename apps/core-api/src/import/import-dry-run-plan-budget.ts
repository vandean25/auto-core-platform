import { rowToRecord, type ParsedCsv } from './csv-parse.util.js';
import type { ImportDryRunPlanBudget } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';

export function dryRunRowNoForSlice(
  budget: ImportDryRunPlanBudget | undefined,
  indexInSlice: number,
): number {
  const base = budget?.rowNoOffset ?? 1;
  return base + indexInSlice;
}

export function shouldStopDryRunPlanningAfterRow(
  budget: ImportDryRunPlanBudget | undefined,
  rowsPlannedInSlice: number,
): boolean {
  if (!budget || rowsPlannedInSlice === 0) {
    return false;
  }
  const now = budget.nowMs?.() ?? Date.now();
  return now >= budget.deadlineMs;
}

/** Plans CSV slice rows in order, stopping once the chunk budget is exceeded after at least one row. */
export function planParsedCsvRowsWithBudget(
  parsed: ParsedCsv,
  budget: ImportDryRunPlanBudget | undefined,
  planRow: (
    rowNo: number,
    record: Record<string, string>,
  ) => DryRunRowResult,
): DryRunRowResult[] {
  const rows: DryRunRowResult[] = [];
  for (let index = 0; index < parsed.rows.length; index++) {
    if (shouldStopDryRunPlanningAfterRow(budget, rows.length)) {
      break;
    }
    const rowNo = dryRunRowNoForSlice(budget, index);
    rows.push(
      planRow(rowNo, rowToRecord(parsed.headers, parsed.rows[index])),
    );
    budget?.onAfterRowPlanned?.();
    if (shouldStopDryRunPlanningAfterRow(budget, rows.length)) {
      break;
    }
  }
  return rows;
}
