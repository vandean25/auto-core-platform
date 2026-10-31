import { ConflictException, NotFoundException } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';

export function importJobNotFound(): NotFoundException {
  return new NotFoundException({
    code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
    message: 'Import job not found',
  });
}

export function applyInProgress(
  leaseExpiresAt: string | null = null,
): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.APPLY_IN_PROGRESS,
    message: 'Import job is already being applied',
    leaseExpiresAt,
  });
}

export function importJobCannotCancel(): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.JOB_STALE,
    message: 'Import job cannot be cancelled in its current phase',
  });
}

export function importJobExpired(): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.JOB_EXPIRED,
    message: 'Import job has expired; please upload and run the dry run again',
  });
}

export function importJobPurged(): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.JOB_PURGED,
    message: 'Staged rows for this import job were purged; please upload again',
  });
}
export function importJobApplyStale(): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.JOB_STALE,
    message: 'Import job cannot be applied in its current status',
  });
}

export async function assertFailedImportJobCanReApply(params: {
  uploadPresent: boolean;
  countApplyRows: () => Promise<number>;
  options?: unknown;
}): Promise<void> {
  const opts = (params.options ?? {}) as Record<string, unknown>;
  if (opts.rows_purged === true) {
    throw importJobPurged();
  }
  if (opts.cancel_reason === 'expired') {
    throw importJobExpired();
  }
  if (params.uploadPresent) {
    return;
  }
  const rowCount = await params.countApplyRows();
  if (rowCount === 0) {
    throw importJobApplyStale();
  }
}

/** Only a dry-run job that is not already applying or applied can be applied. */
export function assertJobCanBeApplied(
  status: ImportJobStatus,
  leaseExpiresAt: string | null = null,
  options?: unknown,
): void {
  if (status === ImportJobStatus.APPLYING) {
    throw applyInProgress(leaseExpiresAt);
  }
  if (status === ImportJobStatus.APPLIED) {
    throw new ConflictException({
      code: IMPORT_ERROR_CODES.JOB_ALREADY_APPLIED,
      message: 'Import job was already applied',
    });
  }
  const opts = (options ?? {}) as Record<string, unknown>;
  if (opts.rows_purged === true) {
    throw importJobPurged();
  }
  if (opts.cancel_reason === 'expired') {
    throw importJobExpired();
  }
  if (status === ImportJobStatus.CANCELLED) {
    throw importJobApplyStale();
  }
  if (
    status !== ImportJobStatus.DRY_RUN_DONE &&
    status !== ImportJobStatus.FAILED
  ) {
    throw importJobApplyStale();
  }
}
