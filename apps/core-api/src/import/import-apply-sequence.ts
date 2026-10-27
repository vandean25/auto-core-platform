export function applySeqForRow(row: {
  apply_seq?: number | null;
  row_no: number;
}): number {
  return row.apply_seq ?? row.row_no;
}

/** Advances only on the next contiguous apply_seq so out-of-order commits cannot skip rows. */
export function advanceContiguousApplySeqWatermark(
  committedWatermark: number,
  committedApplySeq: number,
): number {
  if (committedApplySeq <= committedWatermark) {
    return committedWatermark;
  }
  if (committedApplySeq === committedWatermark + 1) {
    return committedApplySeq;
  }
  return committedWatermark;
}
