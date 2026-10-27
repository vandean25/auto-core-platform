import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { IMPORT_WORKER_LEASE_MS } from './import-job.worker-state.js';

describe('ImportJobStore.extendWorkerLease', () => {
  it('extends the lease only for the current lease token', async () => {
    const updateMany = jest.fn(
      async (_args: {
        data: { options_json: { worker: { lease_until: string } } };
      }) => ({ count: 1 }),
    );
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'token-a',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const prisma = {
      importJob: {
        findFirst: async () => job,
        updateMany,
      },
    };
    const store = new ImportJobStore(prisma as never);
    const before = Date.now();
    const ok = await store.extendWorkerLease('tenant-1', 'job-1', 'token-a');
    expect(ok).toBe(true);
    const patch = updateMany.mock.calls[0]![0];
    const leaseUntil = Date.parse(patch.data.options_json.worker.lease_until);
    expect(leaseUntil).toBeGreaterThanOrEqual(before + IMPORT_WORKER_LEASE_MS - 50);
  });

  it('refuses to extend when the lease token is stale', async () => {
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'token-b',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const prisma = {
      importJob: {
        findFirst: async () => job,
        updateMany: jest.fn(),
      },
    };
    const store = new ImportJobStore(prisma as never);
    const ok = await store.extendWorkerLease('tenant-1', 'job-1', 'token-a');
    expect(ok).toBe(false);
    expect(prisma.importJob.updateMany).not.toHaveBeenCalled();
  });
});
