import type { Logger } from '@nestjs/common';
import type { ImportWorkerPhase } from './import-job.worker-state.js';

export function logImportJobFailed(
  logger: Logger,
  params: {
    jobId: string;
    phase: ImportWorkerPhase;
    attempt: number;
    reason: string;
    cause?: string;
  },
): void {
  const causeSuffix =
    params.cause !== undefined && params.cause !== ''
      ? ` cause=${params.cause}`
      : '';
  logger.error(
    `import.job.failed jobId=${params.jobId} phase=${params.phase} attempt=${params.attempt} reason=${params.reason}${causeSuffix}`,
  );
}
