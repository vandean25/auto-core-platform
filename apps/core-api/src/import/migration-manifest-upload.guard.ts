import { BadRequestException } from '@nestjs/common';
import type { Express } from 'express';
import type { MigrationManifest } from './migration-manifest.types.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { validateMigrationBundle } from './migration-manifest.validator.js';

export function assertCanonicalMigrationUploadAllowed(
  file: Express.Multer.File,
  migrationManifest: MigrationManifest | undefined,
  fileContent?: Buffer,
): void {
  if (!migrationManifest) {
    return;
  }
  const fileName = file.originalname?.trim();
  const content = file.buffer ?? fileContent;
  if (!fileName || !content) {
    return;
  }
  const issues = validateMigrationBundle({
    manifest: migrationManifest,
    files: { [fileName]: content },
    allowPartialFiles: true,
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
