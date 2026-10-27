/** Grace before recovery may enqueue after a handoff (must exceed dispatch deadline + first retry). */
export const IMPORT_WORKER_HANDOFF_GRACE_MS = 10 * 60 * 1000;

export const IMPORT_WORKER_DISPATCH_DEADLINE_SECONDS = 180;

export const IMPORT_WORKER_CHUNK_TIME_BUDGET_MS = 75_000;

export const IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS = 5;

export const IMPORT_UPLOAD_RETENTION_DAYS_DEFAULT = 7;

export function readImportUploadRetentionDays(): number {
  const raw = process.env.IMPORT_UPLOAD_RETENTION_DAYS?.trim();
  if (!raw) {
    return IMPORT_UPLOAD_RETENTION_DAYS_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : IMPORT_UPLOAD_RETENTION_DAYS_DEFAULT;
}
