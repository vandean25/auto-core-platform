import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';
import { IMPORT_WORKER_HANDOFF_GRACE_MS } from './import-worker-handoff.constants.js';

export type StaleImportJobCandidate = {
  tenantId: string;
  jobId: string;
  phase: 'dry_run' | 'apply';
};

export type ImportJobRecoveryRow = {
  id: string;
  tenant_id: string;
  options_json: unknown;
  worker_handoff_at: Date | null;
};

export function isImportWorkerHandoffStale(
  handoffAt: Date | null | undefined,
  nowMs: number,
  graceMs: number = IMPORT_WORKER_HANDOFF_GRACE_MS,
): boolean {
  if (!handoffAt) {
    return true;
  }
  const handoffMs = handoffAt.getTime();
  if (!Number.isFinite(handoffMs)) {
    return true;
  }
  return nowMs - handoffMs >= graceMs;
}

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
    if (!isImportWorkerHandoffStale(row.worker_handoff_at, nowMs)) {
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
