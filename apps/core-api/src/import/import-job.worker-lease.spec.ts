import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { IMPORT_WORKER_LEASE_MS } from './import-job.worker-state.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';

type LeaseJobRecord = {
  id: string;
  tenant_id: string;
  status: ImportJobStatus;
  worker_claim_seq: number;
  attempts_without_progress: number;
  options_json: ImportJobOptionsWithWorker;
};

function leaseJob(overrides: Partial<LeaseJobRecord> = {}): LeaseJobRecord {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    status: ImportJobStatus.APPLYING,
    worker_claim_seq: 0,
    attempts_without_progress: 0,
    options_json: {},
    ...overrides,
  };
}

function claimStore(job: LeaseJobRecord, updateMany = jest.fn(async () => ({ count: 1 }))) {
  const findFirst = jest.fn(async () => job);
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ importJob: { findFirst, updateMany } }),
    importJob: { findFirst, updateMany },
  };
  return { store: new ImportJobStore(prisma as never), updateMany };
}

describe('ImportJobStore worker lease', () => {
  describe('claimWorkerLease', () => {
    it('refuses a second claim while the lease is still valid', async () => {
      const job = leaseJob({
        options_json: {
          worker: {
            phase: 'dry_run',
            lease_token: 'token-a',
            lease_until: new Date(Date.now() + IMPORT_WORKER_LEASE_MS).toISOString(),
            processed_rows: 0,
            started_at: new Date().toISOString(),
          },
        },
      });
      const { store } = claimStore(job);
      expect(await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run')).toBeNull();
    });

    it('claims and rotates the lease token when the lease has expired', async () => {
      const job = leaseJob({
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'token-a',
            lease_until: new Date(0).toISOString(),
            processed_rows: 10,
            last_committed_apply_seq: 10,
            started_at: new Date().toISOString(),
          },
        },
      });
      const { store, updateMany } = claimStore(job);
      const claimed = await store.claimWorkerLease('tenant-1', 'job-1', 'apply');
      expect(claimed?.lease_token).not.toBe('token-a');
      expect(updateMany).toHaveBeenCalled();
    });

    it('marks the job FAILED after repeated claims without progress', async () => {
      const job = leaseJob({
        attempts_without_progress: IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS - 1,
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'token-a',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            claimed_processed_rows: 0,
            last_committed_apply_seq: 0,
            started_at: new Date().toISOString(),
          },
        },
      });
      const { store, updateMany } = claimStore(job);
      expect(await store.claimWorkerLease('tenant-1', 'job-1', 'apply')).toBeNull();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
        }),
      );
    });

    it('resets poison progress when the worker cursor advanced since the last claim', async () => {
      const job = leaseJob({
        worker_claim_seq: 2,
        attempts_without_progress: 3,
        options_json: {
          worker: {
            phase: 'dry_run',
            lease_token: 'token-a',
            lease_until: new Date(0).toISOString(),
            processed_rows: 4,
            claimed_processed_rows: 2,
            started_at: new Date().toISOString(),
          },
        },
      });
      const { store, updateMany } = claimStore(job);
      expect(await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run')).not.toBeNull();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attempts_without_progress: 0 }),
        }),
      );
    });
  });

  describe('extendWorkerLease', () => {
    function extendStore(
      job: LeaseJobRecord,
      updateMany = jest.fn(
        async (_args: { data: { options_json: { worker: { lease_until: string } } } }) => ({
          count: 1,
        }),
      ),
    ) {
      const prisma = {
        importJob: {
          findFirst: async () => job,
          updateMany,
        },
      };
      return { store: new ImportJobStore(prisma as never), updateMany };
    }

    it('extends the lease only for the current lease token', async () => {
      const job = leaseJob({
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'token-a',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            started_at: new Date().toISOString(),
          },
        },
      });
      const { store, updateMany } = extendStore(job);
      const before = Date.now();
      expect(await store.extendWorkerLease('tenant-1', 'job-1', 'token-a')).toBe(true);
      const patch = updateMany.mock.calls[0]![0];
      const leaseUntil = Date.parse(patch.data.options_json.worker.lease_until);
      expect(leaseUntil).toBeGreaterThanOrEqual(before + IMPORT_WORKER_LEASE_MS - 50);
    });

    it('refuses to extend when the lease token is stale', async () => {
      const job = leaseJob({
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'token-b',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            started_at: new Date().toISOString(),
          },
        },
      });
      const { store, updateMany } = extendStore(job, jest.fn());
      expect(await store.extendWorkerLease('tenant-1', 'job-1', 'token-a')).toBe(false);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
