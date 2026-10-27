import { isImportWorkerContentionError } from './import-worker.errors.js';

function driverAdapterWriteConflict(): Error {
  const error = new Error('write conflict');
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'TransactionWriteConflict' } });
  return error;
}

describe('import worker contention (wrapped errors)', () => {
  it('treats a nested adapter write conflict as contention, not a fatal worker error', () => {
    const wrapped = new Error('prisma transaction failed', {
      cause: driverAdapterWriteConflict(),
    });
    expect(isImportWorkerContentionError(wrapped)).toBe(true);
  });
});
