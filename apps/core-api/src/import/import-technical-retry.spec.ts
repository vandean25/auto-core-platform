import { ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { isTechnicalImportRowErrorCode } from './import-apply.errors.js';
import {
  mergeTechnicalRetryBatch,
  planTechnicalRetry,
  withoutTechnicalRetryRow,
} from './import-technical-retry.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';

describe('technical import row retry', () => {
  it('treats apply failure, D1 retry codes, and lease_lost as technical', () => {
    expect(isTechnicalImportRowErrorCode(IMPORT_ERROR_CODES.APPLY_FAILED)).toBe(
      true,
    );
    expect(isTechnicalImportRowErrorCode('P2028')).toBe(true);
    expect(isTechnicalImportRowErrorCode('lease_lost')).toBe(true);
    expect(isTechnicalImportRowErrorCode('VEHICLE_PARTY_OVERLAP')).toBe(false);
    expect(
      isTechnicalImportRowErrorCode(IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE),
    ).toBe(false);
  });

  it('plans only technical error rows', () => {
    const plan = planTechnicalRetry([
      {
        row_no: 1,
        entity_id: null,
        errors_json: [{ code: IMPORT_ERROR_CODES.APPLY_FAILED, message: 'x' }],
      },
      {
        row_no: 2,
        entity_id: 'party-1',
        errors_json: [{ code: 'P2028', message: 'timeout' }],
      },
      {
        row_no: 3,
        entity_id: null,
        errors_json: [{ code: 'VEHICLE_PARTY_OVERLAP', message: 'overlap' }],
      },
    ]);
    expect(plan.rowNos).toEqual([1, 2]);
    expect(plan.codes).toEqual(['IMPORT_APPLY_FAILED', 'P2028']);
  });

  it('puts technical rows ahead of the cursor tail without duplicating a row', () => {
    const retry = [{ row_no: 2, action: ImportRowAction.CREATE }] as never;
    const after = [
      { row_no: 2, action: ImportRowAction.CREATE },
      { row_no: 8, action: ImportRowAction.CREATE },
    ] as never;
    expect(mergeTechnicalRetryBatch(retry, after, 10).rows.map((row) => row.row_no)).toEqual([
      2, 8,
    ]);
  });

  it('drops a committed retry row and keeps the cursor fields', () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 't',
      lease_until: new Date(0).toISOString(),
      processed_rows: 9,
      last_committed_apply_seq: 9,
      started_at: new Date(0).toISOString(),
      technical_retry_row_nos: [2, 4],
    };
    const next = withoutTechnicalRetryRow(worker, 2);
    expect(next.technical_retry_row_nos).toEqual([4]);
    expect(next.last_committed_apply_seq).toBe(9);
  });
});
