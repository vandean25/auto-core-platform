import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { runSyncApplyUnits } from './import-sync-apply-lease.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { SerializedImportJob } from './import-job.serializer.js';

describe('runSyncApplyUnits', () => {
  it('resumes after an expired unit without applying a row twice', async () => {
    const applied: number[] = [];
    const job: {
      id: string;
      status: ImportJobStatus;
      options_json: {
        worker: {
          phase: 'apply';
          lease_token: string;
          lease_until: string;
          processed_rows: number;
          last_committed_apply_seq: number;
          started_at: string;
        };
      };
    } = {
      id: 'job-1',
      status: ImportJobStatus.APPLYING,
      options_json: {
        worker: {
          phase: 'apply' as const,
          lease_token: 'lease-a',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          last_committed_apply_seq: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const rows = [1, 2].map((rowNo) => ({
      row_no: rowNo,
      action: 'CREATE' as const,
      entity_id: null,
      external_id: `K-${rowNo}`,
      normalized_json: {},
    }));

    const result = await runSyncApplyUnits({
      rows,
      initialLeaseToken: 'lease-a',
      findJob: async () => job,
      extendLease: async () => true,
      applyRows: async (pending) => {
        const row = pending[0];
        if (!row) {
          job.status = ImportJobStatus.APPLIED;
          return { status: job.status } as SerializedImportJob;
        }
        applied.push(row.row_no);
        const worker = job.options_json.worker;
        worker.last_committed_apply_seq = row.row_no;
        worker.processed_rows = row.row_no;
        worker.lease_token = 'lease-b';
        job.status =
          row.row_no === 2 ? ImportJobStatus.APPLIED : ImportJobStatus.APPLYING;
        return { status: job.status } as SerializedImportJob;
      },
    });

    expect(applied).toEqual([1, 2]);
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(job.options_json.worker.last_committed_apply_seq).toBe(2);
  });

  it('drops a committed retry row from the list inside the runner', async () => {
    const written: number[] = [];
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING as ImportJobStatus,
      options_json: {
        worker: {
          phase: 'apply' as const,
          lease_token: 'lease-a',
          lease_until: new Date(Date.now() + 60_000).toISOString(),
          processed_rows: 5,
          last_committed_apply_seq: 5,
          started_at: new Date().toISOString(),
          technical_retry_row_nos: [2],
        },
      },
      totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
    };
    const rows = [2, 6].map((rowNo) => ({
      row_no: rowNo,
      apply_seq: rowNo,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: `K-${rowNo}`,
      normalized_json: {},
    }));
    const importJob = {
      findFirst: async () => job,
      update: async (args: {
        data: {
          status?: ImportJobStatus;
          options_json?: { worker: typeof job.options_json.worker };
        };
      }) => {
        if (args.data.options_json?.worker) {
          job.options_json.worker = args.data.options_json.worker;
        }
        if (args.data.status) {
          job.status = args.data.status;
        }
        return job;
      },
      updateMany: async () => ({ count: 1 }),
    };
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        importJob,
        externalIdMapping: { findFirst: async () => null },
        importJobRow: { update: jest.fn() },
      },
      { tenantId: 'tenant-1', expectedRows: 2 },
    );
    const runner = new RowByRowApplyRunner(
      {
        ...tx,
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
          fn(tx),
      } as never,
      { writeImportJobAudit: jest.fn() } as never,
      (updated, totals) =>
        ({
          ...updated,
          totals,
          status: job.status,
        }) as unknown as SerializedImportJob,
    );
    await runSyncApplyUnits({
      rows,
      initialLeaseToken: 'lease-a',
      findJob: async () => job,
      extendLease: async () => true,
      applyRows: (pending, batchOptions) =>
        runner.run(
          {
            tenantId: 'tenant-1',
            job: job as unknown as never,
            rows: pending,
            actorUserId: 'actor',
            effectiveOptions: {},
            preparation: { vendor: null },
          },
          ImportEntityType.CUSTOMER,
          async (_tx, row) => {
            written.push(row.row_no);
          },
          batchOptions,
        ),
    });
    expect(written).toEqual([2, 6]);
    expect(job.options_json.worker.technical_retry_row_nos ?? []).not.toContain(
      2,
    );
  });
});
