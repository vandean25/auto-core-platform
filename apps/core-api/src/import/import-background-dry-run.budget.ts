import type { DryRunRowResult } from './import.types.js';

export function takeDryRunRowsWithinBudget(
  planned: DryRunRowResult[],
  startOffset: number,
  chunkDeadlineMs: number,
  nowMs: () => number = () => Date.now(),
): DryRunRowResult[] {
  const rows: DryRunRowResult[] = [];
  for (let index = 0; index < planned.length; index++) {
    if (nowMs() >= chunkDeadlineMs) {
      break;
    }
    rows.push({
      ...planned[index],
      row_no: startOffset + index + 1,
    });
  }
  return rows;
}
