import { Logger } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import { applyLeaseHolderPrefix } from './import-apply-lease.js';
import { logImportJobFailed } from './import-job-failed-log.util.js';
import type { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import type { ImportJobStore } from './import-job.store.js';
import {
  importWorkerProgressCursor,
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
  logger?: Logger;
};

export function readImportWorkerChunkSeq(
  options: ImportJobOptionsWithWorker,
  phase: ImportWorkerPhase,
): number {
  const worker = readWorkerState(options);
  if (!worker || worker.phase !== phase) {
    return 0;
  }
  return importWorkerProgressCursor(worker);
}

export function importWorkerTaskClaimSeqForHandoff(
  workerClaimSeq: number,
): number {
  return workerClaimSeq + 1;
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
    chunkSeq?: number;
    taskClaimSeq?: number;
    recordHandoffAfterSuccess?: boolean;
  },
): Promise<void> {
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job) {
    return;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const chunkSeq =
    params.chunkSeq ?? readImportWorkerChunkSeq(options, params.phase);
  const taskClaimSeq =
    params.taskClaimSeq ?? importWorkerTaskClaimSeqForHandoff(params.claimSeq);
  await enqueueImportWorkerHandoff(
    {
      jobStore: deps.jobStore,
      cloudTasks: deps.cloudTasks,
      targetBaseUrl: deps.targetBaseUrl,
      nodeEnv: deps.nodeEnv,
      runInline: () => deps.runInline(params.phase),
      recordHandoffAfterSuccess: params.recordHandoffAfterSuccess,
    },
    {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
      chunkSeq,
      claimSeq: taskClaimSeq,
      recoverySeq: params.recoverySeq,
      delaySeconds: params.delaySeconds,
    },
  );
}

export function isApplyingImportWorkerForPhase(
  job: { status: ImportJobStatus } | null | undefined,
  options: ImportJobOptionsWithWorker | null | undefined,
  phase: ImportWorkerPhase,
): boolean {
  if (!job || job.status !== ImportJobStatus.APPLYING) {
    return false;
  }
  const worker = readWorkerState(options);
  return Boolean(worker && worker.phase === phase);
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
  const options = job?.options_json as ImportJobOptionsWithWorker;
  if (!isApplyingImportWorkerForPhase(job, options, params.phase)) {
    return;
  }
  const worker = readWorkerState(options)!;
  logImportJobFailed(deps.logger ?? new Logger('ImportService'), {
    jobId: params.jobId,
    phase: params.phase,
    attempt: job!.attempts_without_progress ?? 0,
    reason: 'lease_lost',
    holder: applyLeaseHolderPrefix(worker.lease_token),
    leaseExpiresAt: worker.lease_until || 'none',
  });
  const leaseUntil = Date.parse(worker.lease_until);
  const delaySeconds =
    Number.isFinite(leaseUntil) && leaseUntil > Date.now()
      ? importWorkerLeaseSkipDelaySeconds(leaseUntil)
      : 0;
  await enqueueImportWorkerContinuation(deps, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: params.phase,
    claimSeq: job!.worker_claim_seq,
    recoverySeq: job!.worker_recovery_seq,
    delaySeconds,
    recordHandoffAfterSuccess: true,
  });
}

export async function handoffImportWorkerAfterBatch(
  deps: ImportWorkerFlowDeps,
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
    leaseToken: string;
    nextChunkSeq: number;
  },
): Promise<void> {
  const released = await deps.jobStore.releaseWorkerLeaseForHandoff(
    params.tenantId,
    params.jobId,
    params.leaseToken,
  );
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job) {
    return;
  }
  if (!released) {
    await requeueImportWorkerAfterLeaseSkip(deps, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
    });
    return;
  }
  await enqueueImportWorkerContinuation(deps, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: params.phase,
    claimSeq: job.worker_claim_seq,
    recoverySeq: job.worker_recovery_seq,
    chunkSeq: params.nextChunkSeq,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(job.worker_claim_seq),
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
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (!job) {
    return;
  }
  const nextRecoverySeq = job.worker_recovery_seq + 1;
  const claimSeq = job.worker_claim_seq;
  const options = job.options_json as ImportJobOptionsWithWorker;
  const chunkSeq = readImportWorkerChunkSeq(options, params.phase);
  const taskClaimSeq = importWorkerTaskClaimSeqForHandoff(claimSeq);
  await enqueueImportWorkerHandoff(
    {
      jobStore: deps.jobStore,
      cloudTasks: deps.cloudTasks,
      targetBaseUrl: deps.targetBaseUrl,
      nodeEnv: deps.nodeEnv,
      runInline: () => deps.runInline(params.phase),
      recordHandoffAfterSuccess: false,
    },
    {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
      chunkSeq,
      claimSeq: taskClaimSeq,
      recoverySeq: nextRecoverySeq,
    },
  );
  await deps.jobStore.confirmWorkerRecoveryHandoff(
    params.tenantId,
    params.jobId,
    nextRecoverySeq,
  );
}
