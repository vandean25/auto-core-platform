import { ConflictException, NotFoundException } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';

export function importJobNotFound(): NotFoundException {
  return new NotFoundException({
    code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
    message: 'Import job not found',
  });
}

export function applyInProgress(): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.APPLY_IN_PROGRESS,
    message: 'Import job is already being applied',
  });
}

export function importJobCannotCancel(): ConflictException {
  return new ConflictException({
    code: IMPORT_ERROR_CODES.JOB_STALE,
    message: 'Import job cannot be cancelled in its current phase',
  });
}

/** Only a dry-run job that is not already applying or applied can be applied. */
export function assertJobCanBeApplied(status: ImportJobStatus): void {
  if (status === ImportJobStatus.APPLYING) {
    throw applyInProgress();
  }
  if (status === ImportJobStatus.APPLIED) {
    throw new ConflictException({
      code: IMPORT_ERROR_CODES.JOB_ALREADY_APPLIED,
      message: 'Import job was already applied',
    });
  }
  if (
    status !== ImportJobStatus.DRY_RUN_DONE &&
    status !== ImportJobStatus.FAILED
  ) {
    throw new ConflictException({
      code: IMPORT_ERROR_CODES.JOB_STALE,
      message: 'Import job cannot be applied in its current status',
    });
  }
}
