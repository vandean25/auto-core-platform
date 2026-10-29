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
    code?: string;
    holder?: string;
    leaseExpiresAt?: string;
  },
): void {
  const causeSuffix =
    params.cause !== undefined && params.cause !== ''
      ? ` cause=${params.cause}`
      : '';
  const codeSuffix =
    params.code !== undefined && params.code !== ''
      ? ` code=${params.code}`
      : '';
  const leaseSuffix =
    params.reason === 'lease_lost'
      ? ` holder=${params.holder || 'none'} leaseExpiresAt=${params.leaseExpiresAt || 'none'}`
      : '';
  logger.error(
    `import.job.failed jobId=${params.jobId} phase=${params.phase} attempt=${params.attempt} reason=${params.reason}${leaseSuffix}${causeSuffix}${codeSuffix}`,
  );
}
