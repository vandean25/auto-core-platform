import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import { applyInProgress } from './import-job.errors.js';
import {
  ApplyRowStaleError,
  classifyImportApplyError,
  coerceWriteRowToDomainError,
  ImportDuplicateCreateInJobError,
  ImportRowDomainError,
  toRowApplyError,
} from './import-apply.errors.js';
import { VEHICLE_PARTY_RULE_CODES } from '../vehicle/vehicle-party.rules.js';

function driverAdapterWriteConflict(): Error {
  const error = new Error('write conflict');
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'TransactionWriteConflict' } });
  return error;
}

function driverAdapterUniqueViolation(): Error {
  const error = new Error('unique');
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'UniqueConstraintViolation' } });
  return error;
}

describe('classifyImportApplyError', () => {
  it('classifies retryable transaction and connection errors', () => {
    const cases: unknown[] = [
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
      new Prisma.PrismaClientKnownRequestError('timeout', {
        code: 'P2028',
        clientVersion: 'test',
      }),
      new Prisma.PrismaClientKnownRequestError('pool', {
        code: 'P2024',
        clientVersion: 'test',
      }),
      driverAdapterWriteConflict(),
      new Prisma.PrismaClientKnownRequestError('deadlock', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { database_error_code: '40001' },
      }),
      new Prisma.PrismaClientKnownRequestError('deadlock', {
        code: 'P2034',
        clientVersion: 'test',
        meta: { database_error_code: '40P01' },
      }),
      Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    ];
    for (const error of cases) {
      expect(classifyImportApplyError(error)).toBe('retryable');
    }
  });

  it('classifies row-level data errors', () => {
    const cases: unknown[] = [
      new ApplyRowStaleError(),
      new ImportDuplicateCreateInJobError(),
      new ImportRowDomainError(VEHICLE_PARTY_RULE_CODES.OVERLAP, 'overlap'),
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'test',
      }),
      driverAdapterUniqueViolation(),
      coerceWriteRowToDomainError(
        new ConflictException({
          code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
          message: 'overlap',
        }),
      ),
      coerceWriteRowToDomainError(
        new UnprocessableEntityException({
          code: VEHICLE_PARTY_RULE_CODES.INTERVAL_INVALID,
          message: 'invalid',
        }),
      ),
      coerceWriteRowToDomainError(
        new NotFoundException({
          code: 'CUSTOMER_NOT_FOUND',
          message: 'missing customer',
        }),
      ),
    ];
    for (const error of cases) {
      expect(classifyImportApplyError(error)).toBe('row');
    }
  });

  it('classifies lease loss and fatal errors', () => {
    expect(classifyImportApplyError(new ImportWorkerLeaseLostError())).toBe(
      'lease_lost',
    );
    expect(classifyImportApplyError(applyInProgress())).toBe('fatal');
    expect(classifyImportApplyError(new Error('boom'))).toBe('fatal');
  });

  it('maps domain errors through toRowApplyError', () => {
    const domain = new ImportRowDomainError(
      VEHICLE_PARTY_RULE_CODES.OVERLAP,
      'overlap',
    );
    expect(toRowApplyError(domain)).toEqual({
      code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
      message: 'overlap',
    });
  });
});
