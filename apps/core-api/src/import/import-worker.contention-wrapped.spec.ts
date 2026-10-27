import { isImportWorkerContentionError } from './import-worker.errors.js';
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
});
