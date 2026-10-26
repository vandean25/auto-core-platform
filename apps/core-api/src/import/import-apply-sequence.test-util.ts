import type { ImportApplyRow } from './import-type-handler.js';
import { orderVehiclePartyApplyRows } from './vehicle-party-import.apply-order.js';

export function assignVehiclePartyApplySeqs(
  rows: ImportApplyRow[],
): ImportApplyRow[] {
  const ordered = orderVehiclePartyApplyRows(rows);
  const seqByRowNo = new Map(
    ordered.map((row, index) => [row.row_no, index + 1]),
  );
  return rows.map((row) => ({
    ...row,
    apply_seq: seqByRowNo.get(row.row_no) ?? row.row_no,
  }));
}

export function pageByApplySeq(
  rows: ImportApplyRow[],
  afterApplySeq: number,
  take: number,
): ImportApplyRow[] {
  return rows
    .filter((row) => (row.apply_seq ?? 0) > afterApplySeq)
    .sort((a, b) => (a.apply_seq ?? 0) - (b.apply_seq ?? 0))
    .slice(0, take);
}

export function maxApplySeq(rows: ImportApplyRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.apply_seq ?? 0), 0);
}
