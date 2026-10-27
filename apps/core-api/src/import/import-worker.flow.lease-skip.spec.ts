import { ImportJobStatus } from '@prisma/client';
import { jest } from '@jest/globals';
import { requeueImportWorkerAfterLeaseSkip } from './import-worker.flow.js';
import { importWorkerTaskIdForParams } from './import-worker-enqueue.js';

describe('requeueImportWorkerAfterLeaseSkip', () => {
  it('enqueues one delayed task under the lease holder task name', async () => {
    const leaseUntil = new Date(Date.now() + 30_000).toISOString();
    const enqueueImportWorker = jest.fn(async () => undefined);
    const touchWorkerHandoff = jest.fn(async () => ({ count: 1 }));
    const findJob = jest.fn(async () => ({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 4,
      worker_recovery_seq: 0,
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'lease',
          lease_until: leaseUntil,
          processed_rows: 10,
          last_committed_apply_seq: 10,
          started_at: new Date().toISOString(),
        },
      },
    }));
    const deps = {
      jobStore: {
        findJob,
        touchWorkerHandoff,
      },
      cloudTasks: {
        isEnabled: () => true,
        enqueueImportWorker,
      },
      targetBaseUrl: 'http://127.0.0.1:3000/api/',
      nodeEnv: 'test',
      runInline: jest.fn(),
    };

    await requeueImportWorkerAfterLeaseSkip(deps as never, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
    });
    await requeueImportWorkerAfterLeaseSkip(deps as never, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
    });

    expect(enqueueImportWorker).toHaveBeenCalledTimes(2);
    const expectedName = importWorkerTaskIdForParams({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
      chunkSeq: 10,
      claimSeq: 4,
      recoverySeq: 0,
    });
    expect(enqueueImportWorker.mock.calls[0]?.[0].taskIdentity).toEqual({
      jobId: 'job-1',
      phase: 'apply',
      chunkSeq: 10,
      claimSeq: 4,
      recoverySeq: 0,
    });
    expect(
      importWorkerTaskIdForParams({
        tenantId: 'tenant-1',
        jobId: 'job-1',
        phase: 'apply',
        chunkSeq: 10,
        claimSeq: 4,
        recoverySeq: 0,
      }),
    ).toBe(expectedName);
    expect(enqueueImportWorker.mock.calls[0]?.[0].delaySeconds).toBeGreaterThan(
      0,
    );
  });

  it('does not enqueue for a terminal job', async () => {
    const enqueueImportWorker = jest.fn();
    const deps = {
      jobStore: {
        findJob: async () => ({
          id: 'job-1',
          status: ImportJobStatus.APPLIED,
        }),
        touchWorkerHandoff: jest.fn(),
      },
      cloudTasks: { isEnabled: () => true, enqueueImportWorker },
      targetBaseUrl: 'http://127.0.0.1:3000/api/',
      runInline: jest.fn(),
    };
    await requeueImportWorkerAfterLeaseSkip(deps as never, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
    });
    expect(enqueueImportWorker).not.toHaveBeenCalled();
  });
});
