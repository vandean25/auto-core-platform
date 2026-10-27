import type { Logger } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import {
  classifyImportApplyError,
  ImportApplyRetryExhaustedError,
} from './import-apply.errors.js';
import type { ImportJobStore } from './import-job.store.js';
import { logImportJobFailed } from './import-job-failed-log.util.js';
import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import {
  enqueueImportWorkerContinuation,
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';
import {
  describeImportWorkerRetryCause,
  importWorkerRetryDelaySeconds,
} from './import-worker-retry.js';
import { isImportWorkerContentionError } from './import-worker.errors.js';

export async function handleImportWorkerAttemptFailure(
  deps: {
    jobStore: ImportJobStore;
    logger: Logger;
    workerFlow: ImportWorkerFlowDeps;
  },
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  },
  error: unknown,
): Promise<void> {
  if (classifyImportApplyError(error) === 'lease_lost') {
    await requeueImportWorkerAfterLeaseSkip(deps.workerFlow, params);
    return;
  }
  if (error instanceof ImportApplyRetryExhaustedError) {
    const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
    if (job?.status === ImportJobStatus.FAILED) {
      logImportJobFailed(deps.logger, {
        jobId: params.jobId,
        phase: params.phase,
        attempt: job.attempts_without_progress,
        reason: 'retry_exhausted',
      });
    }
    return;
  }
  if (classifyImportApplyError(error) === 'retryable') {
    await requeueImportWorkerAfterRetryableError(deps, params, error);
    return;
  }
  if (isImportWorkerContentionError(error)) {
    await requeueImportWorkerAfterLeaseSkip(deps.workerFlow, params);
    return;
  }
  await deps.jobStore.markFailedIfApplying(params.tenantId, params.jobId);
  throw error;
}

async function requeueImportWorkerAfterRetryableError(
  deps: {
    jobStore: ImportJobStore;
    logger: Logger;
    workerFlow: ImportWorkerFlowDeps;
  },
  params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  },
  error: unknown,
): Promise<void> {
  const job = await deps.jobStore.findJob(params.tenantId, params.jobId);
  if (job && job.status === ImportJobStatus.APPLYING) {
    deps.logger.warn(
      `Import worker retryable error; requeueing jobId=${params.jobId} cause=${describeImportWorkerRetryCause(error)}`,
    );
    const options = job.options_json as ImportJobOptionsWithWorker;
    const worker = readWorkerState(options);
    if (worker?.lease_token) {
      await deps.jobStore.releaseWorkerLeaseForRetry(
        params.tenantId,
        params.jobId,
        worker.lease_token,
      );
    }
    await enqueueImportWorkerContinuation(deps.workerFlow, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
      claimSeq: job.worker_claim_seq,
      recoverySeq: job.worker_recovery_seq,
      delaySeconds: importWorkerRetryDelaySeconds(
        job.attempts_without_progress,
      ),
      recordHandoffAfterSuccess: true,
    });
    return;
  }
  deps.logger.warn(
    `Import worker retryable error with job not APPLYING jobId=${params.jobId}`,
  );
}
