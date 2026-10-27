import { Prisma } from '@prisma/client';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import { IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS } from './import.constants.js';
import {
  isImportSyncLegacyApplyPath,
  withImportSyncApplyIoRetry,
} from './import-transaction-retry.util.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('withImportSyncApplyIoRetry', () => {
  it('rethrows immediately when not on the sync legacy path', async () => {
    let calls = 0;
    await expect(
      withImportSyncApplyIoRetry(false, async () => {
        calls += 1;
        throw p2034();
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(calls).toBe(1);
  });

  it('retries retryable errors up to the sync cap', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const exhausted = expect(
      withImportSyncApplyIoRetry(true, async () => {
        calls += 1;
        throw p2034();
      }),
    ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
    await jest.runAllTimersAsync();
    await exhausted;
    expect(calls).toBe(IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS);
    jest.useRealTimers();
  });
});

describe('isImportSyncLegacyApplyPath', () => {
  it('is false for background batch options', () => {
    expect(
      isImportSyncLegacyApplyPath({
        stopAfterBatch: true,
        leaseToken: 'lease',
      }),
    ).toBe(false);
    expect(isImportSyncLegacyApplyPath({ useApplySequence: true })).toBe(
      false,
    );
  });

  it('is true for plain synchronous apply', () => {
    expect(isImportSyncLegacyApplyPath(undefined)).toBe(true);
    expect(isImportSyncLegacyApplyPath({})).toBe(true);
  });
});
