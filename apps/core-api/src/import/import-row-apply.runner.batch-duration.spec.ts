import { Logger } from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';

describe('RowByRowApplyRunner batch duration metric', () => {
  it('logs import.worker.batch_duration_ms for background batches', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const jobRecord = {
      id: 'job-1',
      status: ImportJobStatus.APPLYING,
      totals_json: {},
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'lease',
          lease_until: new Date(Date.now() + 60_000).toISOString(),
          processed_rows: 0,
          last_committed_apply_seq: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const tx = {
      importJob: {
        findFirst: async () => jobRecord,
        update: jest.fn(),
      },
      externalIdMapping: { findFirst: async () => null },
      importJobRow: { update: jest.fn() },
    };
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (innerTx: typeof tx) => Promise<void>) => fn(tx),
      importJob: {
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => jobRecord,
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) => ({ ...job, totals, status: job.status }) as never,
    );
    await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: {},
          totals_json: {
            rows: 1,
            create: 0,
            update: 0,
            skip: 0,
            error: 0,
          },
        },
        rows: [
          {
            row_no: 1,
            apply_seq: 1,
            action: ImportRowAction.SKIP,
            entity_id: null,
            external_id: 'ext-1',
            normalized_json: {},
          },
        ],
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.CUSTOMER,
      async () => undefined,
      {
        stopAfterBatch: true,
        useApplySequence: true,
        leaseToken: 'lease',
        maxApplySeq: 1,
        chunkDeadlineMs: Date.now() + 60_000,
      },
    );
    const metricLine = logSpy.mock.calls
      .map((call) => call[0])
      .find(
        (line) =>
          typeof line === 'string' &&
          line.includes('import.worker.batch_duration_ms'),
      );
    expect(metricLine).toBeDefined();
    logSpy.mockRestore();
  });
});
