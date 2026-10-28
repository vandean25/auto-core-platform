import { ImportJobStatus } from '@prisma/client';
import { runSyncApplyUnits } from './import-sync-apply-lease.js';
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
});
