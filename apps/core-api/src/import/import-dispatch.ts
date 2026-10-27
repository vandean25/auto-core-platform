import { InternalServerErrorException } from '@nestjs/common';
import type { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import type { ImportWorkerPhase } from './import-job.worker-state.js';
import type { ImportWorkerTaskIdentity } from './import-worker-task-identity.js';

export type ImportDispatchMode = 'enqueue' | 'inline';

export function resolveImportDispatch(params: {
  cloudTasksEnabled: boolean;
  targetBaseUrl: string | undefined;
  nodeEnv: string | undefined;
}): ImportDispatchMode {
  const hasTargetBaseUrl = Boolean(params.targetBaseUrl?.trim());
  if (params.cloudTasksEnabled && hasTargetBaseUrl) {
    return 'enqueue';
  }
  if (params.nodeEnv === 'production') {
    throw new InternalServerErrorException(
      'Cloud Tasks is not enabled or not correctly configured for import workers',
    );
  }
  return 'inline';
}

export async function enqueueOrRunImportWorker(params: {
  tenantId: string;
  jobId: string;
  phase: ImportWorkerPhase;
  cloudTasks: Pick<
    ImportCloudTasksService,
    'isEnabled' | 'enqueueImportWorker'
  >;
  targetBaseUrl: string | undefined;
  nodeEnv?: string;
  taskIdentity: ImportWorkerTaskIdentity;
  delaySeconds?: number;
  runInline: () => Promise<void>;
}): Promise<{ mode: ImportDispatchMode }> {
  const mode = resolveImportDispatch({
    cloudTasksEnabled: params.cloudTasks.isEnabled(),
    targetBaseUrl: params.targetBaseUrl,
    nodeEnv: params.nodeEnv,
  });
  if (mode === 'inline') {
    await params.runInline();
    return { mode };
  }
  try {
    await params.cloudTasks.enqueueImportWorker({
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
      taskIdentity: params.taskIdentity,
      delaySeconds: params.delaySeconds,
    });
    return { mode };
  } catch (cause) {
    if (params.nodeEnv === 'production') {
      throw new InternalServerErrorException(
        'Failed to enqueue import background worker',
        { cause },
      );
    }
    throw cause;
  }
}
