import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import { ImportRowAction } from '@prisma/client';

describe('planImportApplyBatch', () => {
  it('slices a background page by batch size when rows are pre-ordered by apply_seq', () => {
    const rows = Array.from({ length: IMPORT_APPLY_BATCH_SIZE + 1 }, (_, index) => ({
      row_no: index + 1,
      apply_seq: index + 1,
      action: ImportRowAction.SKIP,
      entity_id: null,
      external_id: `ext-${index + 1}`,
      normalized_json: {},
    }));
    const plan = planImportApplyBatch(rows, {
      stopAfterBatch: true,
      useApplySequence: true,
      resumeAfterApplySeq: 0,
      hasMoreRowsAfterBatch: true,
    });
    expect(plan.batchRows).toHaveLength(IMPORT_APPLY_BATCH_SIZE);
    expect(plan.batchIncomplete).toBe(true);
  });
});
