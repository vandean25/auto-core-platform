import { BadRequestException } from '@nestjs/common';
import type { Express } from 'express';
import type { MigrationManifest } from './migration-manifest.types.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { validateMigrationBundle } from './migration-manifest.validator.js';

export type MigrationUploadAssessedStats = {
  sha256: string;
  dataRowCount: number;
};

export function assertCanonicalMigrationUploadAllowed(
  file: Express.Multer.File,
  migrationManifest: MigrationManifest | undefined,
  assessed?: MigrationUploadAssessedStats,
): void {
  if (!migrationManifest) {
    return;
  }
  const fileName = file.originalname?.trim();
  if (!fileName) {
    return;
  }
  const buffer = file.buffer;
  const issues = validateMigrationBundle({
    manifest: migrationManifest,
    files: buffer ? { [fileName]: buffer } : {},
    allowPartialFiles: true,
    presentFileNames: buffer ? undefined : [fileName],
    presentFileStats:
      assessed && !buffer
        ? {
            [fileName]: {
              sha256: assessed.sha256,
              rowCount: assessed.dataRowCount,
            },
          }
        : undefined,
  });
  if (issues.length === 0) {
    return;
  }
  throw new BadRequestException({
    code:
      issues[0]?.code ??
      MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
    message: issues[0]?.message ?? 'Migration manifest validation failed',
    issues,
  });
}
