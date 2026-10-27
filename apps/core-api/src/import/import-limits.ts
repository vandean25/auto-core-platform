/** Env-backed import size limits with safe defaults for large migration files. */

const DEFAULT_MAX_ROWS = 250_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_HTTP_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_SYNC_MAX_ROWS = 20_000;
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

export function readImportSyncMaxRowCount(): number {
  return readPositiveInt(
    process.env.IMPORT_SYNC_MAX_ROW_COUNT,
    DEFAULT_SYNC_MAX_ROWS,
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

export function isBackgroundImportCandidate(params: {
  fileBytes: number;
  rowCount?: number;
}): boolean {
  if (params.fileBytes > readImportSyncMaxFileBytes()) {
    return true;
  }
  if (
    params.rowCount !== undefined &&
    params.rowCount > readImportSyncMaxRowCount()
  ) {
    return true;
  }
  return false;
}
