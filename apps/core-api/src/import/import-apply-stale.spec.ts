import { ImportJobStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  isStaleApplyingImportJob,
  IMPORT_STALE_APPLY_WITHOUT_LEASE_MS,
} from './import-apply-lease.js';
import { IMPORT_WORKER_LEASE_MS } from './import-job.worker-state.js';
import { ImportJobStore } from './import-job.store.js';
import { requeueImportWorkerAfterLeaseSkip } from './import-worker.flow.js';

describe('isStaleApplyingImportJob', () => {
  const now = Date.now();

  it('is stale when the lease has expired and fresh while the lease is live', () => {
    const base = {
      status: ImportJobStatus.APPLYING,
      updatedAt: new Date(now),
    };
    expect(
      isStaleApplyingImportJob(
        {
          ...base,
          options_json: {
            worker: {
              phase: 'apply',
              lease_token: 'token-a',
              lease_until: new Date(now - 1000).toISOString(),
              processed_rows: 1,
              started_at: new Date(now).toISOString(),
            },
          },
        },
        now,
      ),
    ).toBe(true);
    expect(
      isStaleApplyingImportJob(
        {
          ...base,
          options_json: {
            worker: {
              phase: 'apply',
              lease_token: 'token-a',
              lease_until: new Date(now + 60_000).toISOString(),
              processed_rows: 1,
              started_at: new Date(now).toISOString(),
            },
          },
        },
        now,
      ),
    ).toBe(false);
  });

  it('treats a released lease as fresh until updatedAt is older than the lease length', () => {
    const released = {
      status: ImportJobStatus.APPLYING,
      options_json: {
        worker: {
          phase: 'apply' as const,
          lease_token: 'token-a',
          lease_until: new Date(0).toISOString(),
          processed_rows: 1,
          started_at: new Date(now).toISOString(),
        },
      },
    };
    expect(
      isStaleApplyingImportJob(
        { ...released, updatedAt: new Date(now - 1000) },
        now,
      ),
    ).toBe(false);
    expect(
      isStaleApplyingImportJob(
        {
          ...released,
          updatedAt: new Date(now - IMPORT_WORKER_LEASE_MS),
        },
        now,
      ),
    ).toBe(true);
  });

  it('treats a lease-less job as stale only after updatedAt ages past five minutes', () => {
    expect(
      isStaleApplyingImportJob(
        {
          status: ImportJobStatus.APPLYING,
          options_json: {},
          updatedAt: new Date(now - IMPORT_STALE_APPLY_WITHOUT_LEASE_MS - 1),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isStaleApplyingImportJob(
        {
          status: ImportJobStatus.APPLYING,
          options_json: {},
          updatedAt: new Date(now - 1000),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStaleApplyingImportJob(
        { status: ImportJobStatus.DRY_RUN_DONE, options_json: {}, updatedAt: new Date(0) },
        now,
      ),
    ).toBe(false);
  });
});

describe('claimWorkerLease takeover', () => {
  it('lets exactly one of two overlapping takeovers win', async () => {
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      attempts_without_progress: 2,
      worker_claim_seq: 1,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'token-old',
          lease_until: new Date(0).toISOString(),
          processed_rows: 4,
          last_committed_apply_seq: 4,
          claimed_processed_rows: 4,
          started_at: new Date().toISOString(),
        },
      },
    };
    const readers: Array<() => void> = [];
    const updateMany = jest.fn(async (args: { where: { options_json: { equals: string } }; data: { options_json: { worker: { lease_token: string; last_committed_apply_seq: number } } } }) => {
      const expected = args.where.options_json.equals;
      const worker = job.options_json.worker;
      if (worker.lease_token !== expected) {
        return { count: 0 };
      }
      job.options_json = args.data.options_json as typeof job.options_json;
      return { count: 1 };
    });
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          importJob: {
            findFirst: () =>
              new Promise<typeof job>((resolve) => {
                readers.push(() => resolve(job));
                if (readers.length === 2) {
                  readers.splice(0).forEach((release) => release());
                }
              }),
            updateMany,
          },
        }),
    };
    const store = new ImportJobStore(prisma as never);
    const [first, second] = await Promise.all([
      store.claimWorkerLease('tenant-1', 'job-1', 'apply'),
      store.claimWorkerLease('tenant-1', 'job-1', 'apply'),
    ]);
    const winners = [first, second].filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.last_committed_apply_seq).toBe(4);
    expect(job.options_json.worker.lease_token).toBe(winners[0]?.lease_token);
  });

  it('adopts a legacy APPLYING job that has no lease and an old updatedAt', async () => {
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      attempts_without_progress: 0,
      worker_claim_seq: 0,
      updatedAt: new Date(Date.now() - IMPORT_STALE_APPLY_WITHOUT_LEASE_MS - 5),
      options_json: {},
    };
    const updateMany = jest.fn(async () => {
      job.options_json = { worker: { lease_token: 'adopted' } };
      return { count: 1 };
    });
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
    expect(claimed?.lease_token).toEqual(expect.any(String));
    expect(claimed?.phase).toBe('apply');
    expect(updateMany).toHaveBeenCalled();
  });
});

describe('requeueImportWorkerAfterLeaseSkip log', () => {
  it('logs lease_lost with jobId, phase, attempt, holder and expiry', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const leaseUntil = new Date(Date.now() + 60_000).toISOString();
    await requeueImportWorkerAfterLeaseSkip(
      {
        jobStore: {
          findJob: async () => ({
            id: 'job-9',
            status: ImportJobStatus.APPLYING,
            worker_claim_seq: 3,
            worker_recovery_seq: 1,
            attempts_without_progress: 4,
            options_json: {
              worker: {
                phase: 'apply',
                lease_token: 'abcdef123456',
                lease_until: leaseUntil,
                processed_rows: 2,
                last_committed_apply_seq: 2,
                started_at: new Date().toISOString(),
              },
            },
          }),
          touchWorkerHandoff: async () => ({ count: 1 }),
        },
        cloudTasks: { isEnabled: () => false, enqueueImportWorker: async () => undefined },
        targetBaseUrl: 'http://127.0.0.1:3000/api/',
        runInline: async () => undefined,
      } as never,
      { tenantId: 'tenant-1', jobId: 'job-9', phase: 'apply' },
    );
    const line = error.mock.calls.map((call) => String(call[0])).join('\n');
    expect(line).toContain('import.job.failed');
    expect(line).toContain('jobId=job-9');
    expect(line).toContain('phase=apply');
    expect(line).toContain('attempt=4');
    expect(line).toContain('reason=lease_lost');
    expect(line).toContain('holder=abcdef12');
    expect(line).toContain(`leaseExpiresAt=${leaseUntil}`);
    error.mockRestore();
  });
});
