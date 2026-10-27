import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';
import { ImportJobStore } from './import-job.store.js';
import { importWorkerRetryDelaySeconds } from './import-worker-retry.js';
import { setupImportHarness } from './import.service.spec.support.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('Import worker background P2034 handling', () => {
  const h = setupImportHarness();
  const worker = {
    phase: 'apply' as const,
    lease_token: 'lease-bg',
    lease_until: new Date(Date.now() + 60_000).toISOString(),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date().toISOString(),
  };

  beforeEach(() => {
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
    h.cloudTasks.isEnabled.mockReturnValue(true);
    h.cloudTasks.enqueueImportWorker.mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const jobStore = (h.service as unknown as { jobStore: ImportJobStore })
      .jobStore;
    jest
      .spyOn(
        h.service as unknown as { workerFlowForJob: () => unknown },
        'workerFlowForJob',
      )
      .mockReturnValue({
        jobStore,
        cloudTasks: h.cloudTasks,
        targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL,
        runInline: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      });
    jest
      .spyOn(jobStore, 'releaseWorkerLeaseForRetry')
      .mockImplementation(() => Promise.resolve(true));
    jest
      .spyOn(jobStore, 'touchWorkerHandoff')
      .mockResolvedValue({ count: 1 });
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.CLOUD_TASKS_INVOKER_SA = 'sa@test';
    process.env.CLOUD_TASKS_LOCATION = 'europe-west1';
    process.env.CLOUD_TASKS_QUEUE = 'import';
    process.env.CLOUD_TASKS_WORKER_SECRET = 'secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
  });

  it('keeps APPLYING and enqueues a continuation with retry delay', async () => {
    const attempts = 2;
    const jobStore = (h.service as unknown as { jobStore: ImportJobStore })
      .jobStore;
    jest.spyOn(jobStore, 'findJob').mockResolvedValue({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 4,
      worker_recovery_seq: 1,
      attempts_without_progress: attempts,
      options_json: { worker },
    } as never);

    await (
      h.service as unknown as {
        failImportWorkerAttemptUnlessContention: (
          params: { tenantId: string; jobId: string; phase: 'apply' },
          error: unknown,
        ) => Promise<void>;
      }
    ).failImportWorkerAttemptUnlessContention(
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'apply' },
      p2034(),
    );

    expect(h.cloudTasks.enqueueImportWorker).toHaveBeenCalled();
    const delaySeconds = (
      h.cloudTasks.enqueueImportWorker.mock.calls[0]?.[0] as {
        delaySeconds?: number;
      }
    )?.delaySeconds;
    expect(delaySeconds).toBe(importWorkerRetryDelaySeconds(attempts));
    const job = await jobStore.findJob('tenant-1', 'job-1');
    expect(job?.status).toBe(ImportJobStatus.APPLYING);
  });

  it('marks FAILED with poison_cap after repeated claims without progress', async () => {
    const updateMany = jest.fn<() => Promise<{ count: number }>>();
    updateMany.mockResolvedValueOnce({ count: 1 });
    updateMany.mockResolvedValueOnce({ count: 0 });
    const job = {
      id: 'job-poison',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 0,
      attempts_without_progress:
        IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS - 1,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'token-poison',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          claimed_processed_rows: 0,
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
    const claimed = await store.claimWorkerLease(
      'tenant-1',
      'job-poison',
      'apply',
    );
    expect(claimed).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ImportJobStatus.FAILED,
          options_json: expect.objectContaining({
            apply_failure_reason: 'poison_cap',
          }),
        }),
      }),
    );
  });
});
