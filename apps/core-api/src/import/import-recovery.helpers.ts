import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';

export type StaleImportJobCandidate = {
  tenantId: string;
  jobId: string;
  phase: 'dry_run' | 'apply';
};

export type ImportJobRecoveryRow = {
  id: string;
  tenant_id: string;
  options_json: unknown;
};

export function filterExpiredImportWorkerCandidates(
  rows: ImportJobRecoveryRow[],
  nowMs: number,
): StaleImportJobCandidate[] {
  const candidates: StaleImportJobCandidate[] = [];
  for (const row of rows) {
    const worker = readWorkerState(
      row.options_json as ImportJobOptionsWithWorker,
    );
    if (!worker) {
      continue;
    }
    const leaseUntil = Date.parse(worker.lease_until);
    if (Number.isFinite(leaseUntil) && leaseUntil > nowMs) {
      continue;
    }
    candidates.push({
      tenantId: row.tenant_id,
      jobId: row.id,
      phase: worker.phase,
    });
  }
  return candidates;
}
