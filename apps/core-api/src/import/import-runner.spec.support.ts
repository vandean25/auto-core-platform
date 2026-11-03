import { ImportJobStatus, Prisma } from '@prisma/client';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type {
  ImportJobView,
  SerializedImportJob,
} from './import-job.serializer.js';
import type { ImportJobTotals } from './import.types.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';

export function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

export function p2028(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Transaction API error', {
    code: 'P2028',
    clientVersion: 'test',
  });
}

export function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

export function driverAdapterWriteConflict(): Error {
  const error = new Error('write conflict');
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'TransactionWriteConflict' } });
  return error;
}

export function emptyTotals(rows: number): ImportJobTotals {
  return { rows, create: 0, update: 0, skip: 0, error: 0 };
}

export function createApplyWorker(
  leaseToken = 'lease-apply',
): ImportJobWorkerState {
  return {
    phase: 'apply',
    lease_token: leaseToken,
    lease_until: new Date(0).toISOString(),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date().toISOString(),
  };
}

const echoSerializer = (
  job: ImportJobView,
  totals: ImportJobTotals,
): SerializedImportJob =>
  ({
    ...job,
    totals,
    status: job.status,
  }) as unknown as SerializedImportJob;

const appliedSerializer = (
  job: ImportJobView,
  totals: ImportJobTotals,
): SerializedImportJob =>
  ({
    ...job,
    totals,
    status: ImportJobStatus.APPLIED,
  }) as unknown as SerializedImportJob;

export function makeRowRunner(prisma: unknown): RowByRowApplyRunner {
  return new RowByRowApplyRunner(
    prisma as never,
    { writeImportJobAudit: jest.fn() } as never,
    echoSerializer,
  );
}

/** The runner reports the job as applied; these specs assert on rows and totals. */
export function makeAppliedRowRunner(prisma: unknown): RowByRowApplyRunner {
  return new RowByRowApplyRunner(
    prisma as never,
    { writeImportJobAudit: jest.fn() } as never,
    appliedSerializer,
  );
}

export function makeSupplierRunner(prisma: unknown): SupplierChunkedApplyRunner {
  return new SupplierChunkedApplyRunner(
    prisma as never,
    { writeImportJobAudit: jest.fn() } as never,
    echoSerializer,
  );
}
