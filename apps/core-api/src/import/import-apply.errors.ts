import { Prisma } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';

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

// Only conflicts with this row's own data are recorded as ERROR rows: a stale plan, a
// unique violation, a foreign key failure or a referenced record that is gone. Deadlocks,
// write conflicts, pool or transaction timeouts and connection loss are not row problems
// and must surface instead of being turned into row errors.
export function isRowLevelApplyError(error: unknown): boolean {
  if (
    error instanceof ApplyRowStaleError ||
    error instanceof ImportDuplicateCreateInJobError
  ) {
    return true;
  }
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2003', 'P2025'].includes(error.code)
  );
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
