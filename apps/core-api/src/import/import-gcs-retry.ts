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
  if (isTransientImportStorageReadError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const status = (error as { status?: unknown; statusCode?: unknown }).status;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return httpStatusRetryable(status) || httpStatusRetryable(statusCode);
}

function httpStatusRetryable(status: unknown): boolean {
  return status === 429 || (typeof status === 'number' && status >= 500);
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

export async function withTransientGcsAttempts<T>(
  jobId: string,
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      await cleanup().catch(() => undefined);
      const retry =
        isTransientGcsUploadError(error) && attempt < UPLOAD_ATTEMPTS - 1;
      if (!retry) {
        break;
      }
      await wait(retryDelayMs(attempt));
    }
  }
  throw new ImportStorageUnavailableError(jobId, last);
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
