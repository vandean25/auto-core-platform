import { BadRequestException } from '@nestjs/common';
import type { CanonicalMigrationBundleService } from './canonical-migration-bundle.service.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from '../migration-manifest.errors.js';
import {
  parseMigrationManifestJson,
  type MigrationManifest,
} from '../migration-manifest.validator.js';

export function validateCanonicalMigrationUpload(
  bundleService: CanonicalMigrationBundleService,
  uploads: {
    manifest?: Express.Multer.File[];
    files?: Express.Multer.File[];
    assets?: Express.Multer.File[];
  },
) {
  const manifestFile = uploads.manifest?.[0];
  if (!manifestFile?.buffer) {
    throw new BadRequestException({
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
      message: 'manifest file is required',
    });
  }
  let manifest: MigrationManifest;
  try {
    manifest = parseMigrationManifestJson(manifestFile.buffer);
  } catch {
    throw new BadRequestException({
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
      message: 'manifest.json is not valid JSON',
    });
  }
  const files: Record<string, Buffer> = {};
  for (const file of uploads.files ?? []) {
    if (file.originalname) {
      files[file.originalname] = file.buffer;
    }
  }
  const assets: Record<string, Buffer> = {};
  for (const file of uploads.assets ?? []) {
    if (file.originalname) {
      assets[file.originalname] = file.buffer;
    }
  }
  return bundleService.validateBundle({ manifest, files, assets });
}
