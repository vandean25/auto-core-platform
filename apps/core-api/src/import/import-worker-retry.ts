import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';

export function isTransientImportStorageReadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('timeout') ||
    message.includes('503') ||
    message.includes('429')
  );
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

export function importWorkerLeaseSkipDelaySeconds(leaseUntilMs: number): number {
  const remainingMs = Math.max(0, leaseUntilMs - Date.now());
  const jitterMs = Math.floor(Math.random() * 3000);
  return Math.max(1, Math.ceil((remainingMs + jitterMs) / 1000));
}
