import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';

describe('RowByRowApplyRunner deferred worker cursor', () => {
  it('commits the high-water row only after every row in the page finishes', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-1',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_row_no: 0,
      started_at: new Date().toISOString(),
    };
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          importJob: {
            findFirst: async () => ({
              id: 'job-1',
              status: ImportJobStatus.APPLYING,
              options_json: { worker },
            }),
            update: async (args: {
              data: { options_json?: { worker: ImportJobWorkerState } };
            }) => {
              if (args.data.options_json?.worker) {
                Object.assign(worker, args.data.options_json.worker);
              }
            },
          },
        };
        return fn(tx);
      },
      importJob: {
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => ({
          id: 'job-1',
          status: ImportJobStatus.APPLYING,
          totals_json: {},
        }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const rows = [
      {
        row_no: 51,
        action: ImportRowAction.SKIP,
        entity_id: null,
        external_id: 'b',
        normalized_json: {},
      },
      {
        row_no: 50,
        action: ImportRowAction.SKIP,
        entity_id: null,
        external_id: 'a',
        normalized_json: {},
      },
    ];
    await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: { worker },
          totals_json: { rows: 51, create: 0, update: 0, skip: 0, error: 0 },
        },
        rows,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.CUSTOMER,
      async () => undefined,
      {
        stopAfterBatch: true,
        deferWorkerCursorCommits: true,
        applyEntireWorkerPage: true,
        leaseToken: worker.lease_token,
      },
    );
    expect(worker.last_committed_row_no).toBe(51);
  });
});
