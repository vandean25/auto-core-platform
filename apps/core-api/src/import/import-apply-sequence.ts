export function applySeqForRow(row: {
  apply_seq?: number | null;
  row_no: number;
}): number {
  return row.apply_seq ?? row.row_no;
}
