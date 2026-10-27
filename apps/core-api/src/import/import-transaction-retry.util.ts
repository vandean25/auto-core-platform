import {
  classifyImportApplyError,
  ImportApplyRetryExhaustedError,
} from './import-apply.errors.js';
import { IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS } from './import.constants.js';

export function retryableTransactionDelayMs(attempt: number): number {
  const cappedBase = Math.min(50 * 2 ** attempt, 2000);
  const jitter = Math.floor(Math.random() * cappedBase * 0.25);
  return cappedBase + jitter;
}

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Legacy synchronous apply (no worker lease / batch continuation). */
export function isImportSyncLegacyApplyPath(options?: {
  leaseToken?: string;
  stopAfterBatch?: boolean;
  useApplySequence?: boolean;
}): boolean {
  if (options?.useApplySequence) {
    return false;
  }
  if (options?.leaseToken || options?.stopAfterBatch) {
    return false;
  }
  return true;
}

export async function withImportSyncApplyIoRetry<T>(
  isSyncPath: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isSyncPath) {
    return operation();
  }
  const maxAttempts = IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (classifyImportApplyError(error) !== 'retryable') {
        throw error;
      }
      if (attempt < maxAttempts - 1) {
        await delayMs(retryableTransactionDelayMs(attempt));
        continue;
      }
      throw new ImportApplyRetryExhaustedError(error);
    }
  }
  throw new Error('import sync apply IO retry exhausted without result');
}
