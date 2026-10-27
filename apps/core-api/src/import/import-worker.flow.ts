import { ImportJobStatus } from '@prisma/client';
import type { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import type { ImportJobStore } from './import-job.store.js';
import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import { enqueueImportWorkerHandoff } from './import-worker-enqueue.js';
import { importWorkerLeaseSkipDelaySeconds } from './import-worker-retry.js';

export type ImportWorkerFlowDeps = {
  jobStore: ImportJobStore;
  cloudTasks: Pick<
    ImportCloudTasksService,
    'isEnabled' | 'enqueueImportWorker'
  >;
  targetBaseUrl: string | undefined;
  nodeEnv?: string;
  runInline: (phase: ImportWorkerPhase) => Promise<void>;
};

export function readImportWorkerChunkSeq(
  options: ImportJobOptionsWithWorker,
  phase: ImportWorkerPhase,
): number {
  const worker = readWorkerState(options);
  if (!worker) {
    return 0;
  }
  if (phase === 'apply') {
    return worker.last_committed_apply_seq ?? 0;
  }
  return worker.processed_rows ?? 0;
}

export async function enqueueImportWorkerContinuation(
  deps: ImportWorkerFlowDeps,
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
    claimSeq: number;
    recoverySeq: number;
    delaySeconds?: number;
  },
): Promise<void> {
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job) {
    return;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const chunkSeq = readImportWorkerChunkSeq(options, params.phase);
  await enqueueImportWorkerHandoff(
    {
      jobStore: deps.jobStore,
      cloudTasks: deps.cloudTasks,
      targetBaseUrl: deps.targetBaseUrl,
      nodeEnv: deps.nodeEnv,
      runInline: () => deps.runInline(params.phase),
    },
    {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
      chunkSeq,
      claimSeq: params.claimSeq,
      recoverySeq: params.recoverySeq,
      delaySeconds: params.delaySeconds,
    },
  );
}

export async function requeueImportWorkerAfterLeaseSkip(
  deps: ImportWorkerFlowDeps,
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  },
): Promise<void> {
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job || job.status !== ImportJobStatus.APPLYING) {
    return;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const worker = readWorkerState(options);
  if (!worker || worker.phase !== params.phase) {
    return;
  }
  const leaseUntil = Date.parse(worker.lease_until);
  if (!Number.isFinite(leaseUntil) || leaseUntil <= Date.now()) {
    return;
  }
  await enqueueImportWorkerContinuation(deps, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: params.phase,
    claimSeq: job.worker_claim_seq,
    recoverySeq: job.worker_recovery_seq,
    delaySeconds: importWorkerLeaseSkipDelaySeconds(leaseUntil),
  });
}

export async function handoffImportWorkerAfterBatch(
  deps: ImportWorkerFlowDeps,
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
    leaseToken: string;
  },
): Promise<void> {
  const extended = await deps.jobStore.extendWorkerLease(
    params.tenantId,
    params.jobId,
    params.leaseToken,
  );
  if (!extended) {
    return;
  }
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job) {
    return;
  }
  await enqueueImportWorkerContinuation(deps, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: params.phase,
    claimSeq: job.worker_claim_seq,
    recoverySeq: job.worker_recovery_seq,
  });
}

export async function enqueueImportWorkerRecoveryHandoff(
  deps: ImportWorkerFlowDeps,
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  },
): Promise<void> {
  const recoverySeq = await deps.jobStore.bumpWorkerRecoverySeq(
    params.tenantId,
    params.jobId,
  );
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job) {
    return;
  }
  const claimSeq = job.worker_claim_seq;
  await enqueueImportWorkerContinuation(deps, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: params.phase,
    claimSeq,
    recoverySeq,
  });
}
