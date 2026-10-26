import type { ImportApplyRow } from './import-type-handler.js';

/** Default background apply_seq order (matches sync row_no order). */
export function sortImportApplyRowsByRowNo(
  rows: ImportApplyRow[],
): ImportApplyRow[] {
  return [...rows].sort((a, b) => a.row_no - b.row_no);
}

export function applySeqForRow(row: {
  apply_seq?: number | null;
  row_no: number;
}): number {
  return row.apply_seq ?? row.row_no;
}
