import type { ImportJobOptions, ImportJobTotals } from './import.types.js';

export type ImportWorkerPhase = 'dry_run' | 'apply';

export type ImportJobWorkerState = {
  phase: ImportWorkerPhase;
  lease_token: string;
  lease_until: string;
  processed_rows: number;
  /** Background apply cursor over import_job_rows.apply_seq. */
  last_committed_apply_seq?: number;
  started_at: string;
};

export type ImportJobUploadRef = {
  object_key: string;
};

export type ImportJobOptionsWithWorker = ImportJobOptions & {
  worker?: ImportJobWorkerState;
  upload?: ImportJobUploadRef;
};

export type ImportJobProgress = {
  phase: ImportWorkerPhase | null;
  processed_rows: number;
  total_rows: number;
  eta_seconds: number | null;
};

export const IMPORT_WORKER_LEASE_MS = 120_000;

export function readWorkerState(
  options: ImportJobOptionsWithWorker | null | undefined,
): ImportJobWorkerState | null {
  const worker = options?.worker;
  if (!worker?.phase || !worker.lease_token) {
    return null;
  }
  return worker;
}

export function readUploadRef(
  options: ImportJobOptionsWithWorker | null | undefined,
): ImportJobUploadRef | null {
  const upload = options?.upload;
  if (!upload?.object_key) {
    return null;
  }
  return upload;
}

export function computeImportProgress(params: {
  status: string;
  totals: ImportJobTotals;
  options: ImportJobOptionsWithWorker | null | undefined;
}): ImportJobProgress | null {
  const worker = readWorkerState(params.options);
  if (params.status !== 'APPLYING' || !worker) {
    return null;
  }
  const totalRows = Math.max(params.totals.rows, worker.processed_rows, 1);
  const processed = worker.processed_rows;
  const startedAt = Date.parse(worker.started_at);
  const elapsedSec =
    Number.isFinite(startedAt) && startedAt > 0
      ? Math.max(0.001, (Date.now() - startedAt) / 1000)
      : null;
  const etaSeconds =
    elapsedSec && processed > 0
      ? Math.round((elapsedSec / processed) * (totalRows - processed))
      : null;
  return {
    phase: worker.phase,
    processed_rows: processed,
    total_rows: totalRows,
    eta_seconds: etaSeconds,
  };
}
