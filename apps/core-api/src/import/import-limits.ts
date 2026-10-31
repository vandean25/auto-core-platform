/** Env-backed import size limits with safe defaults for large migration files. */

const DEFAULT_MAX_ROWS = 250_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_HTTP_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_DIRECT_UPLOAD_MAX_BYTES = 250 * 1024 * 1024;
const DEFAULT_SYNC_MAX_BYTES = 10 * 1024 * 1024;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readImportMaxRowCount(): number {
  return readPositiveInt(process.env.IMPORT_MAX_ROW_COUNT, DEFAULT_MAX_ROWS);
}

export function readImportMaxFileBytes(): number {
  return readPositiveInt(process.env.IMPORT_MAX_FILE_BYTES, DEFAULT_MAX_BYTES);
}

export function readImportUploadMaxFileBytes(): number {
  return readPositiveInt(
    process.env.IMPORT_UPLOAD_MAX_FILE_BYTES,
    DEFAULT_HTTP_UPLOAD_MAX_BYTES,
  );
}

/** Browser-to-GCS uploads bypass the 32 MiB Cloud Run request cap. */
export function readImportDirectUploadMaxFileBytes(): number {
  return readPositiveInt(
    process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES,
    DEFAULT_DIRECT_UPLOAD_MAX_BYTES,
  );
}

export function readImportSyncMaxFileBytes(): number {
  return readPositiveInt(
    process.env.IMPORT_SYNC_MAX_FILE_BYTES,
    DEFAULT_SYNC_MAX_BYTES,
  );
}

export function readImportWorkerBatchSize(): number {
  return readPositiveInt(process.env.IMPORT_WORKER_BATCH_SIZE, 500);
}

export function readImportApplyBatchSize(): number {
  return readPositiveInt(process.env.IMPORT_APPLY_BATCH_SIZE, 50);
}

const DEFAULT_UPLOAD_RETENTION_DAYS = 7;

export function readImportUploadRetentionDays(): number {
  return readPositiveInt(
    process.env.IMPORT_UPLOAD_RETENTION_DAYS,
    DEFAULT_UPLOAD_RETENTION_DAYS,
  );
}

const DEFAULT_JOB_ROW_PURGE_ROW_BATCH_SIZE = 500;
const DEFAULT_JOB_ROW_PURGE_ROW_BUDGET = 20_000;
const DEFAULT_JOB_ROW_PURGE_MAX_CANDIDATES_SCANNED = 500;

export function readImportJobRowPurgeRowBatchSize(): number {
  return readPositiveInt(
    process.env.IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE,
    DEFAULT_JOB_ROW_PURGE_ROW_BATCH_SIZE,
  );
}

export function readImportJobRowPurgeRowBudget(): number {
  return readPositiveInt(
    process.env.IMPORT_JOB_ROW_PURGE_ROW_BUDGET,
    DEFAULT_JOB_ROW_PURGE_ROW_BUDGET,
  );
}

export function readImportJobRowPurgeMaxCandidatesScanned(): number {
  return readPositiveInt(
    process.env.IMPORT_JOB_ROW_PURGE_MAX_CANDIDATES_SCANNED,
    DEFAULT_JOB_ROW_PURGE_MAX_CANDIDATES_SCANNED,
  );
}

export function isBackgroundImportCandidate(params: {
  fileBytes: number;
}): boolean {
  return params.fileBytes > readImportSyncMaxFileBytes();
}
