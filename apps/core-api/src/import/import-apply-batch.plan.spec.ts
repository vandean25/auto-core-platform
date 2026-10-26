import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import { ImportRowAction } from '@prisma/client';

describe('planImportApplyBatch', () => {
  it('applies an expanded worker page without slicing back to the batch size', () => {
    const rows = Array.from({ length: IMPORT_APPLY_BATCH_SIZE + 1 }, (_, index) => ({
      row_no: index + 1,
      action: ImportRowAction.SKIP,
      entity_id: null,
      external_id: `ext-${index + 1}`,
      normalized_json: {},
    }));
    const plan = planImportApplyBatch(rows, {
      stopAfterBatch: true,
      applyEntireWorkerPage: true,
      resumeAfterRowNo: 0,
    });
    expect(plan.batchRows).toHaveLength(IMPORT_APPLY_BATCH_SIZE + 1);
  });
});
