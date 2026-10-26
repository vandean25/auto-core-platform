import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyRow,
} from './import-type-handler.js';

export function planImportApplyBatch(
  rows: ImportApplyRow[],
  options?: ImportApplyBatchOptions,
) {
  const resumeAfter = options?.resumeAfterRowNo ?? 0;
  const pending = rows.filter((row) => row.row_no > resumeAfter);
  const batchSize = options?.applyEntireWorkerPage
    ? pending.length
    : options?.stopAfterBatch
      ? IMPORT_APPLY_BATCH_SIZE
      : pending.length;
  const batchRows = pending.slice(0, batchSize);
  const batchIncomplete =
    Boolean(options?.stopAfterBatch) &&
    (options?.hasMoreRowsAfterBatch ?? pending.length > batchRows.length);
  return { resumeAfter, batchRows, batchIncomplete };
}
