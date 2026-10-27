import { advanceContiguousApplySeqWatermark } from './import-apply-sequence.js';

describe('advanceContiguousApplySeqWatermark', () => {
  it('advances only on the next contiguous apply_seq', () => {
    expect(advanceContiguousApplySeqWatermark(0, 1)).toBe(1);
    expect(advanceContiguousApplySeqWatermark(1, 2)).toBe(2);
  });

  it('does not jump forward when a higher apply_seq commits first', () => {
    expect(advanceContiguousApplySeqWatermark(0, 2)).toBe(0);
    expect(advanceContiguousApplySeqWatermark(0, 3)).toBe(0);
    expect(advanceContiguousApplySeqWatermark(1, 3)).toBe(1);
  });

  it('ignores duplicate or stale commits', () => {
    expect(advanceContiguousApplySeqWatermark(2, 2)).toBe(2);
    expect(advanceContiguousApplySeqWatermark(2, 1)).toBe(2);
  });
});
