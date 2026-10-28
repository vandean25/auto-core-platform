import { ServiceUnavailableException } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { isTransientImportStorageReadError } from './import-worker-retry.js';

const UPLOAD_ATTEMPTS = 3;

export class ImportStorageUnavailableError extends Error {
  readonly jobId: string;

  constructor(jobId: string, cause: unknown) {
    super('Import file storage is temporarily unavailable');
    this.name = 'ImportStorageUnavailableError';
    this.jobId = jobId;
    this.cause = cause;
  }
}

export function isTransientGcsUploadError(error: unknown): boolean {
  if (isPreconditionFailure(error)) {
    return false;
  }
  if (isTransientImportStorageReadError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return httpStatusRetryable(status) || httpStatusRetryable(statusCode);
}

function httpStatusRetryable(status: unknown): boolean {
  return (
    status === 429 ||
    (typeof status === 'number' && status >= 500 && status !== 412)
  );
}

export function isPreconditionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const coded = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return coded.code === 412 || coded.status === 412 || coded.statusCode === 412;
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const coded = error as { code?: unknown; status?: unknown };
  return coded.code === 404 || coded.status === 404;
}

type AttemptKind = 'committed' | 'retry' | 'fatal';

export function classifyGcsUploadAttempt(
  error: unknown,
  attempt: number,
): AttemptKind {
  if (attempt > 0 && isPreconditionFailure(error)) {
    return 'committed';
  }
  if (isTransientGcsUploadError(error) && attempt < UPLOAD_ATTEMPTS - 1) {
    return 'retry';
  }
  return 'fatal';
}

function retryDelayMs(attempt: number): number {
  const base = Number(process.env.IMPORT_GCS_RETRY_BASE_MS ?? 40);
  const unit = Number.isFinite(base) && base >= 0 ? base : 40;
  const jitter = unit === 0 ? 0 : Math.floor(Math.random() * unit);
  return unit * 2 ** attempt + jitter;
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function objectState(
  committed: () => Promise<boolean>,
): Promise<'yes' | 'no' | 'unknown'> {
  try {
    return (await committed()) ? 'yes' : 'no';
  } catch (error) {
    return isNotFound(error) ? 'no' : 'unknown';
  }
}

export async function withTransientGcsAttempts(
  jobId: string,
  operation: () => Promise<void>,
  cleanup: () => Promise<void>,
  committed: () => Promise<boolean>,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    const finished = await runAttempt(operation);
    if (finished.ok) {
      return;
    }
    last = finished.error;
    const kind = classifyGcsUploadAttempt(finished.error, attempt);
    if (await finishAttempt(jobId, kind, cleanup, committed)) {
      return;
    }
    if (kind === 'fatal') {
      break;
    }
    await wait(retryDelayMs(attempt));
  }
  throw new ImportStorageUnavailableError(jobId, last);
}

async function runAttempt(
  operation: () => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await operation();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function finishAttempt(
  jobId: string,
  kind: AttemptKind,
  cleanup: () => Promise<void>,
  committed: () => Promise<boolean>,
): Promise<boolean> {
  if (kind === 'committed') {
    if (!(await committed())) {
      throw new ImportStorageUnavailableError(jobId, new Error('412'));
    }
    return true;
  }
  const state = await objectState(committed);
  if (state === 'yes') {
    return true;
  }
  if (kind === 'fatal' || state === 'no') {
    await cleanup().catch(() => undefined);
  }
  return false;
}

export function importStorageUnavailableException(
  error: ImportStorageUnavailableError,
): ServiceUnavailableException {
  const exception = new ServiceUnavailableException({
    code: IMPORT_ERROR_CODES.STORAGE_UNAVAILABLE,
    message: 'The import file could not be saved. Please try again.',
  });
  (exception as { importJobId?: string }).importJobId = error.jobId;
  return exception;
}

export function rethrowImportStorageFailure(error: unknown): never {
  if (error instanceof ImportStorageUnavailableError) {
    throw importStorageUnavailableException(error);
  }
  throw error;
}
