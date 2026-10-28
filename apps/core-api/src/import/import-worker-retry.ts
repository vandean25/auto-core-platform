import { Prisma } from '@prisma/client';
import {
  isRetryableTransactionError,
  readErrorCause,
} from '../common/prisma/is-retryable-transaction-error.js';

export function isTransientImportStorageReadError(error: unknown): boolean {
  return (
    storageReadErrorIsTransient(error) ||
    storageReadErrorIsTransient(readErrorCause(error))
  );
}

export const TRANSIENT_STORAGE_CODE = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

function retryableStorageSignal(value: unknown): boolean {
  if (typeof value === 'number') {
    return value === 429 || value >= 500;
  }
  return typeof value === 'string' && TRANSIENT_STORAGE_CODE.has(value);
}

function storageMessageIsTransient(message: string): boolean {
  return /socket hang up|econnreset|timeout|503|429/.test(
    message.toLowerCase(),
  );
}

function storageReadErrorIsTransient(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const coded = error as { code?: unknown; status?: unknown };
  return (
    retryableStorageSignal(coded.code) ||
    retryableStorageSignal(coded.status) ||
    storageMessageIsTransient(error.message)
  );
}

export function describeImportWorkerRetryCause(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  const cause = readErrorCause(error);
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    return cause.code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

export function isRetryableImportWorkerError(error: unknown): boolean {
  return (
    isRetryableTransactionError(error) ||
    isTransientImportStorageReadError(error)
  );
}

export function importWorkerRetryDelaySeconds(attempt = 0): number {
  const base = Math.min(60, 2 ** attempt);
  const jitter = Math.floor(Math.random() * 3);
  return base + jitter;
}

export function importWorkerLeaseSkipDelaySeconds(
  leaseUntilMs: number,
): number {
  const remainingMs = Math.max(0, leaseUntilMs - Date.now());
  const jitterMs = Math.floor(Math.random() * 3000);
  return Math.max(1, Math.ceil((remainingMs + jitterMs) / 1000));
}
