import { ImportJobStatus } from '@prisma/client';
import { jest } from '@jest/globals';
import {
  enqueueImportWorkerContinuation,
  handoffImportWorkerAfterBatch,
  requeueImportWorkerAfterLeaseSkip,
} from './import-worker.flow.js';
import { importWorkerTaskIdForParams } from './import-worker-enqueue.js';

describe('import worker task identity dedup', () => {
  const leaseUntil = new Date(Date.now() + 30_000).toISOString();
  const job = {
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
  };

  function buildDeps(enqueueImportWorker: jest.Mock) {
    return {
      jobStore: {
        findJob: jest.fn(async () => job),
        releaseWorkerLeaseForHandoff: jest.fn(async () => true),
        touchWorkerHandoff: jest.fn(async () => ({ count: 1 })),
      },
      cloudTasks: {
        isEnabled: () => true,
        enqueueImportWorker: enqueueImportWorker as never,
      },
      targetBaseUrl: 'http://127.0.0.1:3000/api/',
      nodeEnv: 'test',
      runInline: jest.fn(),
    };
  }

  it('uses one task name for duplicate lease-skips and the holder handoff', async () => {
    const enqueueImportWorker = jest.fn(async () => undefined);
    const deps = buildDeps(enqueueImportWorker);

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
    await handoffImportWorkerAfterBatch(deps as never, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
      leaseToken: 'lease',
      nextChunkSeq: 10,
    });

    expect(enqueueImportWorker).toHaveBeenCalledTimes(3);
    const names = enqueueImportWorker.mock.calls.map((call) => {
      const identity = call[0]?.taskIdentity;
      return importWorkerTaskIdForParams({
        tenantId: 'tenant-1',
        jobId: 'job-1',
        phase: 'apply',
        chunkSeq: identity!.chunkSeq,
        claimSeq: identity!.claimSeq,
        recoverySeq: identity!.recoverySeq,
      });
    });
    expect(new Set(names).size).toBe(1);
  });

  it('uses a different task name after a retryable error handoff', async () => {
    const enqueueImportWorker = jest.fn(async () => undefined);
    const deps = buildDeps(enqueueImportWorker);

    await requeueImportWorkerAfterLeaseSkip(deps as never, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
    });
    const claimedJob = { ...job, worker_claim_seq: 5 };
    deps.jobStore.findJob = jest.fn(async () => claimedJob);
    await enqueueImportWorkerContinuation(deps as never, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
      claimSeq: claimedJob.worker_claim_seq,
      recoverySeq: claimedJob.worker_recovery_seq,
      delaySeconds: 30,
    });

    const skipName = importWorkerTaskIdForParams({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
      chunkSeq: 10,
      claimSeq: 5,
      recoverySeq: 0,
    });
    const retryName = importWorkerTaskIdForParams({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
      chunkSeq: 10,
      claimSeq: 6,
      recoverySeq: 0,
    });
    expect(skipName).not.toBe(retryName);
  });
});
