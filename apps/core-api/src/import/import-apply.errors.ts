import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
  isRetryableTransactionError,
  readErrorCause,
} from '../common/prisma/is-retryable-transaction-error.js';
import { isTransientImportStorageReadError } from './import-worker-retry.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

export type ImportApplyErrorKind = 'lease_lost' | 'retryable' | 'row' | 'fatal';

export type ImportApplyFailureReason =
  'retry_exhausted' | 'poison_cap' | 'apply_error' | 'apply_seq_missing';

export class ApplyRowStaleError extends Error {
  constructor(message = 'Import row plan is stale') {
    super(message);
    this.name = 'ApplyRowStaleError';
  }
}

export class ImportDuplicateCreateInJobError extends Error {
  constructor(
    message = 'Duplicate create: this external_id was already applied from another row in this import job',
  ) {
    super(message);
    this.name = 'ImportDuplicateCreateInJobError';
  }
}

/** Row-level domain failure surfaced from HTTP writers during apply (404/409/422). */
export class ImportRowDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportRowDomainError';
  }
}

/** Sync apply exhausted in-process retries for a retryable error; job may be resumed. */
export class ImportApplyRetryExhaustedError extends Error {
  constructor(readonly cause: unknown) {
    super('Import apply retryable attempts exhausted');
    this.name = 'ImportApplyRetryExhaustedError';
  }
}

const MAX_CAUSE_DEPTH = 8;

function adapterCauseKind(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  const kind = (node as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : undefined;
}

function isDriverAdapterRowConstraintNode(node: unknown): boolean {
  if (node instanceof Error && node.name === 'DriverAdapterError') {
    const kind = adapterCauseKind(readErrorCause(node));
    return (
      kind === 'UniqueConstraintViolation' ||
      kind === 'ForeignKeyConstraintViolation'
    );
  }
  const kind = adapterCauseKind(node);
  return (
    kind === 'UniqueConstraintViolation' ||
    kind === 'ForeignKeyConstraintViolation'
  );
}

function isDriverAdapterRowConstraint(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    if (isDriverAdapterRowConstraintNode(current)) {
      return true;
    }
    current = readErrorCause(current);
  }
  return false;
}

function isPrismaRowConstraint(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  return ['P2002', 'P2003', 'P2025'].includes(error.code);
}

function isRowConstraintError(error: unknown): boolean {
  if (
    error instanceof ApplyRowStaleError ||
    error instanceof ImportDuplicateCreateInJobError ||
    error instanceof ImportRowDomainError
  ) {
    return true;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    isPrismaRowConstraint(error)
  ) {
    return true;
  }
  return isDriverAdapterRowConstraint(error);
}

/** Classifies apply errors for retry, row ERROR, or job-level failure. */
export function classifyImportApplyError(error: unknown): ImportApplyErrorKind {
  if (error instanceof ImportWorkerLeaseLostError) {
    return 'lease_lost';
  }
  if (error instanceof ImportApplyRetryExhaustedError) {
    return 'fatal';
  }
  if (
    isRetryableTransactionError(error) ||
    isTransientImportStorageReadError(error)
  ) {
    return 'retryable';
  }
  if (isRowConstraintError(error)) {
    return 'row';
  }
  return 'fatal';
}

export function isRowLevelApplyError(error: unknown): boolean {
  return classifyImportApplyError(error) === 'row';
}

export function coerceWriteRowToDomainError(error: unknown): unknown {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404 || status === 409 || status === 422) {
      const response = error.getResponse();
      const body =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>)
          : {};
      const code =
        typeof body.code === 'string'
          ? body.code
          : IMPORT_ERROR_CODES.APPLY_FAILED;
      const message =
        typeof body.message === 'string'
          ? body.message
          : 'Row failed during apply';
      return new ImportRowDomainError(code, message);
    }
  }
  return error;
}

/** The code and message stored on a row that failed during apply. */
export function toRowApplyError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof ApplyRowStaleError) {
    return { code: IMPORT_ERROR_CODES.ROW_STALE, message: error.message };
  }
  if (error instanceof ImportDuplicateCreateInJobError) {
    return {
      code: IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
      message: error.message,
    };
  }
  if (error instanceof ImportRowDomainError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: IMPORT_ERROR_CODES.APPLY_FAILED,
    message: 'Row failed during apply',
  };
}

export function resolveImportExternalId(
  payload: Record<string, unknown>,
  rowExternalId: string | null,
): string {
  const raw = payload.external_id ?? rowExternalId ?? '';
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return '';
}
