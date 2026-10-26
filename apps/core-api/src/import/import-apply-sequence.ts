/** SQL ORDER BY terms for assigning apply_seq (must match in-memory sync order). */
export const DEFAULT_IMPORT_APPLY_SEQUENCE_ORDER =
  'row_no ASC';

export const VEHICLE_PARTY_IMPORT_APPLY_SEQUENCE_ORDER =
  `(action <> 'UPDATE'::"ImportRowAction"), row_no ASC`;

export function applySeqForRow(row: {
  apply_seq?: number | null;
  row_no: number;
}): number {
  return row.apply_seq ?? row.row_no;
}
