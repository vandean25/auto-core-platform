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

const scheduledInlineWorkers = new Set<ReturnType<typeof setTimeout>>();

/** Drops inline retries still waiting on a timer. Tests call this before closing the database. */
export function clearScheduledInlineImportWorkers(): void {
  for (const timer of scheduledInlineWorkers) clearTimeout(timer);
  scheduledInlineWorkers.clear();
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
    const delaySeconds = params.delaySeconds ?? 0;
    if (delaySeconds > 0) {
      const timer = setTimeout(() => {
        scheduledInlineWorkers.delete(timer);
        void params.runInline();
      }, delaySeconds * 1000);
      timer.unref?.();
      scheduledInlineWorkers.add(timer);
      return { mode };
    }
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
