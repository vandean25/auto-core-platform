import { isImportWorkerContentionError } from './import-worker.errors.js';
import { classifyImportApplyError } from './import-apply.errors.js';
import { isRetryableImportWorkerError } from './import-worker-retry.js';

function driverAdapterWriteConflict(): Error {
  const error = new Error('write conflict');
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'TransactionWriteConflict' } });
  return error;
}

describe('import worker contention (wrapped errors)', () => {
  it('routes nested adapter write conflicts to retry, not lease contention', () => {
    const wrapped = new Error('prisma transaction failed', {
      cause: driverAdapterWriteConflict(),
    });
    expect(isImportWorkerContentionError(wrapped)).toBe(false);
    expect(isRetryableImportWorkerError(wrapped)).toBe(true);
  });

  it('classifies a worker GCS read failure as retryable', () => {
    const reset = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    const unavailable = Object.assign(new Error('storage'), { code: 503 });
    expect(isRetryableImportWorkerError(reset)).toBe(true);
    expect(isRetryableImportWorkerError(unavailable)).toBe(true);
  });

  it('retries a fetch failure whose reset is on the cause', () => {
    const reset = new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
    const hungUp = new TypeError('fetch failed', {
      cause: new Error('socket hang up'),
    });
    for (const error of [reset, hungUp]) {
      expect(isRetryableImportWorkerError(error)).toBe(true);
      expect(classifyImportApplyError(error)).toBe('retryable');
    }
  });
});
