import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  setupImportCollaborators,
  setupImportHarness,
} from './import.service.spec.support.js';
import { ImportJobStatus } from '@prisma/client';
import {
  IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS,
} from './import-worker-handoff.constants.js';
import { p2034 } from './import-runner.spec.support.js';

describe('ImportService.recoverStaleImportJobs', () => {
  const h = setupImportHarness();
  let activeTenant = '';

  beforeEach(() => {
    activeTenant = '';
    h.cloudTasks.isEnabled.mockReturnValue(true);
    h.cloudTasks.enqueueImportWorker.mockResolvedValue(undefined);
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
    h.systemPrisma.withCronJobLock.mockImplementation(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
        return true;
      },
    );
    h.requestContext.runAsWorker = jest.fn(
      async (tenantId: string, fn: () => Promise<void>) => {
        activeTenant = tenantId;
        await fn();
      },
    );
    h.systemPrisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-a' },
      { id: 'tenant-b' },
    ]);
    h.prisma.importJob.findMany = jest.fn().mockImplementation(() => {
      if (activeTenant === 'tenant-a') {
        return Promise.resolve([
          {
            id: 'job-a',
            tenant_id: 'tenant-a',
            worker_handoff_at: new Date(0),
            options_json: {
              worker: {
                phase: 'dry_run',
                lease_token: 'lease',
                lease_until: new Date(0).toISOString(),
                processed_rows: 0,
                started_at: new Date().toISOString(),
              },
            },
          },
        ]);
      }
      if (activeTenant === 'tenant-b') {
        return Promise.reject(new Error('tenant-b listing failed'));
      }
      return Promise.resolve([]);
    });
    h.prisma.importJob.findFirst = jest.fn(async () => ({
      id: 'job-a',
      tenant_id: 'tenant-a',
      worker_claim_seq: 2,
      worker_recovery_seq: 1,
      options_json: {
        worker: {
          phase: 'dry_run',
          lease_token: 'lease',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          started_at: new Date().toISOString(),
        },
      },
    }));
    h.prisma.importJob.updateMany = jest.fn(async () => ({ count: 1 }));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest
      .spyOn(h.service, 'runImportWorkerAttempt')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
  });

  it('enqueues recovery tasks per tenant and never runs the worker inline', async () => {
    await h.service.recoverStaleImportJobs();

    expect(h.cloudTasks.enqueueImportWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        jobId: 'job-a',
        phase: 'dry_run',
        taskIdentity: expect.objectContaining({
          jobId: 'job-a',
          claimSeq: 3,
          recoverySeq: 2,
        }),
      }),
    );
    expect(h.requestContext.runAsWorker).toHaveBeenCalledWith(
      'tenant-a',
      expect.any(Function),
      expect.anything(),
    );
    expect(h.requestContext.runAsWorker).toHaveBeenCalledWith(
      'tenant-b',
      expect.any(Function),
      expect.anything(),
    );
    expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ worker_recovery_seq: 2 }),
      }),
    );
  });
});

describe('ImportService worker retryable apply errors', () => {
  const h = setupImportHarness();
  const c = setupImportCollaborators(h);
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
      .spyOn(c.jobStore, 'releaseWorkerLeaseForRetry')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
  });

  it('warn-logs and requeues when a retryable error hits an APPLYING job', async () => {
    await c.orchestration.failWorkerAttemptUnlessContention(
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

describe('Import worker background P2034 handling', () => {
  const h = setupImportHarness();
  const c = setupImportCollaborators(h);
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
    jest
      .spyOn(c.jobStore, 'releaseWorkerLeaseForRetry')
      .mockImplementation(() => Promise.resolve(true));
    jest
      .spyOn(c.jobStore, 'touchWorkerHandoff')
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

  it('keeps the lease released for retry and enqueues a continuation with retry delay', async () => {
    const attempts = 2;
    jest.spyOn(c.jobStore, 'findJob').mockResolvedValue({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 4,
      worker_recovery_seq: 1,
      attempts_without_progress: attempts,
      options_json: { worker },
    } as never);

    await c.orchestration.failWorkerAttemptUnlessContention(
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'apply' },
      p2034(),
    );

    expect(c.jobStore.releaseWorkerLeaseForRetry).toHaveBeenCalledWith(
      'tenant-1',
      'job-1',
      'lease-bg',
    );
    const delaySeconds = (
      h.cloudTasks.enqueueImportWorker.mock.calls[0]?.[0] as {
        delaySeconds?: number;
      }
    )?.delaySeconds;
    const baseDelay = Math.min(60, 2 ** attempts);
    expect(delaySeconds).toBeGreaterThanOrEqual(baseDelay);
    expect(delaySeconds).toBeLessThanOrEqual(baseDelay + 2);
  });
});

describe('Import worker import.job.failed logging', () => {
  const h = setupImportHarness();
  const c = setupImportCollaborators(h);

  beforeEach(() => {
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
    h.cloudTasks.isEnabled.mockReturnValue(true);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('logs when poison cap marks the job FAILED', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const job = {
      id: 'job-poison-log',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.FAILED,
      worker_claim_seq: 0,
      worker_recovery_seq: 0,
      attempts_without_progress: IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS,
      options_json: {
        apply_failure_reason: 'poison_cap',
        worker: {
          phase: 'dry_run',
          lease_token: 'token',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          claimed_processed_rows: 0,
          dry_run_reconcile_active: true,
          dry_run_reconcile_cursor: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    jest.spyOn(c.jobStore, 'claimWorkerLease').mockResolvedValue(null);
    jest.spyOn(c.jobStore, 'findJob').mockResolvedValue(job as never);

    await c.orchestration.runWorkerAttempt({
      tenantId: 'tenant-1',
      jobId: 'job-poison-log',
      phase: 'dry_run',
    });

    expect(errorLog).toHaveBeenCalledWith(
      'import.job.failed jobId=job-poison-log phase=dry_run attempt=5 reason=poison_cap',
    );
  });
});
