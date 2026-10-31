import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import { applyInProgress, assertJobCanBeApplied } from './import-job.errors.js';
import {
  ApplyRowStaleError,
  classifyImportApplyError,
  coerceWriteRowToDomainError,
  ImportDuplicateCreateInJobError,
  ImportRowDomainError,
  readImportFailureDetail,
  toRowApplyError,
} from './import-apply.errors.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
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

describe('assertJobCanBeApplied', () => {
  it('forwards the live lease on an applying conflict', () => {
    const leaseExpiresAt = '2026-10-28T12:00:00.000Z';
    let response: unknown;
    try {
      assertJobCanBeApplied(ImportJobStatus.APPLYING, leaseExpiresAt);
    } catch (error) {
      response = (error as ConflictException).getResponse();
    }
    expect(response).toMatchObject({
      code: 'IMPORT_APPLY_IN_PROGRESS',
      message: 'Import job is already being applied',
      leaseExpiresAt,
    });
  });

  it('still applies a FAILED job, so its staged rows must survive the failure', () => {
    expect(() => assertJobCanBeApplied(ImportJobStatus.FAILED)).not.toThrow();
  });
});

describe('readImportFailureDetail', () => {
  it('reads the code and message of a rejected import request', () => {
    expect(
      readImportFailureDetail(
        new BadRequestException({
          code: IMPORT_ERROR_CODES.INVALID_ENCODING,
          message: 'CSV must be UTF-8 encoded',
        }),
      ),
    ).toEqual({
      code: IMPORT_ERROR_CODES.INVALID_ENCODING,
      message: 'CSV must be UTF-8 encoded',
    });
  });

  it('returns nothing for errors without an import error code', () => {
    expect(readImportFailureDetail(new Error('boom'))).toBeUndefined();
    expect(
      readImportFailureDetail(new BadRequestException('plain text')),
    ).toBeUndefined();
  });
});

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
      new NotFoundException('Record not found'),
      driverAdapterUniqueViolation(),
      Object.assign(new Error('fk'), {
        name: 'DriverAdapterError',
        cause: { kind: 'ForeignKeyConstraintViolation' },
      }),
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
