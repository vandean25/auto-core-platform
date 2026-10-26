import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { isRetryableTransactionError } from './is-retryable-transaction-error.js';

describe('isRetryableTransactionError', () => {
  it('classifies DriverAdapterError TransactionWriteConflict as retryable', () => {
    const error = new DriverAdapterError({ kind: 'TransactionWriteConflict' });
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it('classifies P2028 as retryable', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error',
      { code: 'P2028', clientVersion: 'test' },
    );
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it('classifies P2002 as not retryable', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(isRetryableTransactionError(error)).toBe(false);
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
