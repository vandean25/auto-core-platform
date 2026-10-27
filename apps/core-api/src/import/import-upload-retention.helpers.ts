import { ImportJobStatus } from '@prisma/client';
import { readImportUploadRetentionDays } from './import-worker-handoff.constants.js';

export function importUploadRetentionCutoff(
  now: Date,
  retentionDays = readImportUploadRetentionDays(),
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export const IMPORT_UPLOAD_DELETE_STATUSES: ImportJobStatus[] = [
  ImportJobStatus.APPLIED,
  ImportJobStatus.CANCELLED,
  ImportJobStatus.DRY_RUN_DONE,
];
