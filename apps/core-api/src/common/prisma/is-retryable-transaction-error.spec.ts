import { Prisma } from '@prisma/client';
import { isRetryableTransactionError } from './is-retryable-transaction-error.js';

function driverAdapterWriteConflict(): Error {
  const error = new Error(
    'Transaction failed due to a write conflict or a deadlock.',
  );
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'TransactionWriteConflict' } });
  return error;
}

describe('isRetryableTransactionError', () => {
  it('classifies DriverAdapterError TransactionWriteConflict as retryable', () => {
    expect(isRetryableTransactionError(driverAdapterWriteConflict())).toBe(
      true,
    );
  });

  it('classifies a wrapped adapter write conflict as retryable', () => {
    const wrapped = new Error('wrapped', { cause: driverAdapterWriteConflict() });
    expect(isRetryableTransactionError(wrapped)).toBe(true);
  });

  it('classifies P2028 and P2024 as retryable', () => {
    const timeout = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error',
      { code: 'P2028', clientVersion: 'test' },
    );
    const pool = new Prisma.PrismaClientKnownRequestError('Pool timeout', {
      code: 'P2024',
      clientVersion: 'test',
    });
    expect(isRetryableTransactionError(timeout)).toBe(true);
    expect(isRetryableTransactionError(pool)).toBe(true);
  });

  it('classifies P2002, P2003, and P2025 as not retryable', () => {
    for (const code of ['P2002', 'P2003', 'P2025'] as const) {
      const error = new Prisma.PrismaClientKnownRequestError(code, {
        code,
        clientVersion: 'test',
      });
      expect(isRetryableTransactionError(error)).toBe(false);
    }
  });

  it('classifies ECONNRESET as retryable', () => {
    const error = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it('does not classify unrelated messages that mention connection reset', () => {
    expect(
      isRetryableTransactionError(
        new Error('User said connection reset in a note field'),
      ),
    ).toBe(false);
    expect(isRetryableTransactionError(new Error('Connection lost'))).toBe(
      false,
    );
  });

  it('classifies deadlock SQLSTATE on a non-retry Prisma code as retryable', () => {
    const deadlock = new Prisma.PrismaClientKnownRequestError('deadlock', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { database_error_code: '40001' },
    });
    expect(isRetryableTransactionError(deadlock)).toBe(true);
  });

  it('classifies serialization failure and deadlock SQLSTATE as retryable', () => {
    const serialization = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const deadlock = new Prisma.PrismaClientKnownRequestError('deadlock', {
      code: 'P2034',
      clientVersion: 'test',
      meta: { database_error_code: '40P01' },
    });
    expect(isRetryableTransactionError(serialization)).toBe(true);
    expect(isRetryableTransactionError(deadlock)).toBe(true);
  });
});
