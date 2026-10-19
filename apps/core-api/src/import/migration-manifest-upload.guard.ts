import { BadRequestException } from '@nestjs/common';
import type { Express } from 'express';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import type { ImportJobOptions } from './import.types.js';
import {
  validateMigrationBundle,
  type MigrationManifest,
} from './migration-manifest.validator.js';

export function assertCanonicalMigrationUploadAllowed(
  file: Express.Multer.File,
  options: ImportJobOptions,
): void {
  if (!options.migration_manifest) {
    return;
  }
  const manifest = options.migration_manifest as MigrationManifest;
  const fileName = file.originalname?.trim();
  if (!fileName || !file.buffer) {
    return;
  }
  const issues = validateMigrationBundle({
    manifest,
    files: { [fileName]: file.buffer },
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
