import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';

describe('ImportJobStore poison job cap', () => {
  it('marks the job FAILED after repeated claims without progress', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 0,
      attempts_without_progress:
        IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS - 1,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'token-a',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          last_committed_apply_seq: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          importJob: {
            findFirst: async () => job,
            updateMany,
          },
        }),
    };
    const store = new ImportJobStore(prisma as never);
    const claimed = await store.claimWorkerLease('tenant-1', 'job-1', 'apply');
    expect(claimed).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
      }),
    );
  });
});
