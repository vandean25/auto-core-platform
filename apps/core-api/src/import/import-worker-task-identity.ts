import { createHash } from 'node:crypto';
import type { ImportWorkerPhase } from './import-job.worker-state.js';

export type ImportWorkerTaskIdentity = {
  jobId: string;
  phase: ImportWorkerPhase;
  chunkSeq: number;
  claimSeq: number;
  recoverySeq: number;
};

export function deterministicImportWorkerTaskId(
  identity: ImportWorkerTaskIdentity,
): string {
  const digest = createHash('sha256')
    .update(
      [
        identity.jobId,
        identity.phase,
        identity.chunkSeq,
        identity.claimSeq,
        identity.recoverySeq,
      ].join(':'),
    )
    .digest('hex');
  return `import-worker-${digest.slice(0, 40)}`;
}
