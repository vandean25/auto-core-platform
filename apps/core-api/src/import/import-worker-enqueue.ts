import type { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import {
  enqueueOrRunImportWorker,
  type ImportDispatchMode,
} from './import-dispatch.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportWorkerPhase } from './import-job.worker-state.js';
import {
  deterministicImportWorkerTaskId,
  type ImportWorkerTaskIdentity,
} from './import-worker-task-identity.js';

export type EnqueueImportWorkerHandoffParams = {
  tenantId: string;
  jobId: string;
  phase: ImportWorkerPhase;
  chunkSeq: number;
  claimSeq: number;
  recoverySeq: number;
  delaySeconds?: number;
};

export function buildImportWorkerTaskIdentity(
  params: EnqueueImportWorkerHandoffParams,
): ImportWorkerTaskIdentity {
  return {
    jobId: params.jobId,
    phase: params.phase,
    chunkSeq: params.chunkSeq,
    claimSeq: params.claimSeq,
    recoverySeq: params.recoverySeq,
  };
}

export async function recordImportWorkerHandoff(
  jobStore: ImportJobStore,
  tenantId: string,
  jobId: string,
): Promise<void> {
  await jobStore.touchWorkerHandoff(tenantId, jobId);
}

export async function enqueueImportWorkerHandoff(
  deps: {
    jobStore: ImportJobStore;
    cloudTasks: Pick<
      ImportCloudTasksService,
      'isEnabled' | 'enqueueImportWorker'
    >;
    targetBaseUrl: string | undefined;
    nodeEnv?: string;
    runInline: () => Promise<void>;
    recordHandoffAfterSuccess?: boolean;
  },
  params: EnqueueImportWorkerHandoffParams,
): Promise<{ mode: ImportDispatchMode }> {
  const taskIdentity = buildImportWorkerTaskIdentity(params);
  const result = await enqueueOrRunImportWorker({
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: params.phase,
    cloudTasks: deps.cloudTasks,
    targetBaseUrl: deps.targetBaseUrl,
    nodeEnv: deps.nodeEnv,
    taskIdentity,
    delaySeconds: params.delaySeconds,
    runInline: deps.runInline,
  });
  if (deps.recordHandoffAfterSuccess) {
    await recordImportWorkerHandoff(
      deps.jobStore,
      params.tenantId,
      params.jobId,
    );
  }
  return result;
}

export function importWorkerTaskIdForParams(
  params: EnqueueImportWorkerHandoffParams,
): string {
  return deterministicImportWorkerTaskId(buildImportWorkerTaskIdentity(params));
}
