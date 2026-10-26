import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { IMPORT_WORKER_LEASE_MS } from './import-job.worker-state.js';

describe('ImportJobStore.claimWorkerLease', () => {
  it('refuses a second claim while the lease is still valid', async () => {
    const future = new Date(Date.now() + IMPORT_WORKER_LEASE_MS).toISOString();
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      options_json: {
        worker: {
          phase: 'dry_run',
          lease_token: 'token-a',
          lease_until: future,
          processed_rows: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          importJob: {
            findFirst: async () => job,
            updateMany: jest.fn(),
          },
        }),
    };
    const store = new ImportJobStore(prisma as never);
    const claimed = await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run');
    expect(claimed).toBeNull();
  });

  it('claims and rotates the lease token when the lease has expired', async () => {
    const past = new Date(0).toISOString();
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'token-a',
          lease_until: past,
          processed_rows: 10,
          last_committed_row_no: 10,
          started_at: new Date().toISOString(),
        },
      },
    };
    const updateMany = jest.fn(async () => ({ count: 1 }));
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
    expect(claimed?.lease_token).not.toBe('token-a');
    expect(updateMany).toHaveBeenCalled();
  });
});
