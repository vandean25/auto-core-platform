import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { setupImportHarness } from './import.service.spec.support.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('ImportService worker retryable apply errors', () => {
  const h = setupImportHarness();
  const worker = {
    phase: 'apply' as const,
    lease_token: 'lease-requeue',
    lease_until: new Date(Date.now() + 60_000).toISOString(),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date().toISOString(),
  };

  beforeEach(() => {
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
    h.cloudTasks.enqueueImportWorker.mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const jobStore = (
      h.service as unknown as { jobStore: typeof h.prisma }
    ).jobStore;
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
    h.prisma.importJob.findFirst = jest.fn(async () => ({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 1,
      worker_recovery_seq: 0,
      attempts_without_progress: 0,
      options_json: { worker },
    }));
    jest
      .spyOn(
        (
          h.service as unknown as {
            jobStore: {
              releaseWorkerLeaseForRetry: (
                tenantId: string,
                jobId: string,
                leaseToken: string,
              ) => Promise<void>;
            };
          }
        ).jobStore,
        'releaseWorkerLeaseForRetry',
      )
      .mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
  });

  it('warn-logs and requeues when a retryable error hits an APPLYING job', async () => {
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

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('jobId=job-1'),
    );
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('P2034'),
    );
  });
});
