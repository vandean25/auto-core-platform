import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';

export class ImportWorkerLeaseLostError extends Error {
  readonly name = 'ImportWorkerLeaseLostError';
}

export function isImportWorkerContentionError(error: unknown): boolean {
  if (error instanceof ImportWorkerLeaseLostError) {
    return true;
  }
  return isRetryableTransactionError(error);
}
