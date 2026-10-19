import {
  MIGRATION_CSV_FILE_SPECS,
  type MigrationCsvFileName,
} from './migration-csv-dictionary.js';
import { validateMigrationCsvFile } from './migration-csv-file.validation.js';
import { validateMigrationBundleControlTotals } from './migration-bundle.control-totals.validation.js';
import {
  validateMigrationBundleFileSet,
  validateMigrationHandlerCapabilities,
  validateMigrationManifestSchema,
  validateMigrationReservedFilesForVersion,
  validateMigrationSourceSystem,
} from './migration-bundle.manifest.validation.js';
import { validateMigrationManifestReconciliationV11 } from './migration-manifest-reconciliation.v11.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import type {
  MigrationBundleInput,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export type {
  MigrationBundleInput,
  MigrationManifest,
  MigrationManifestFileEntry,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

function isMigrationCsvFileName(name: string): name is MigrationCsvFileName {
  return name in MIGRATION_CSV_FILE_SPECS;
}

export function validateMigrationBundle(
  input: MigrationBundleInput,
): MigrationValidationIssue[] {
  const issues: MigrationValidationIssue[] = [];
  const manifest = input.manifest;
  const allowPartialFiles = input.allowPartialFiles === true;

  validateMigrationManifestSchema(manifest, issues);
  if (
    issues.some(
      (issue) =>
        issue.code ===
        MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_FORMAT_VERSION,
    )
  ) {
    return issues;
  }

  validateMigrationSourceSystem(manifest, issues);
  validateMigrationBundleFileSet(
    manifest,
    input.files,
    issues,
    allowPartialFiles,
  );
  validateMigrationReservedFilesForVersion(manifest, issues);
  validateMigrationBundleControlTotals(
    manifest,
    input.files,
    issues,
    allowPartialFiles,
  );
  validateMigrationManifestReconciliationV11(
    manifest,
    input.files,
    input.assets ?? {},
    issues,
    { allowPartialFiles },
  );

  const filesPresent = new Set(Object.keys(input.files));
  validateMigrationHandlerCapabilities(
    manifest,
    issues,
    filesPresent,
    allowPartialFiles,
  );

  for (const entry of manifest.files) {
    if (!isMigrationCsvFileName(entry.name)) {
      continue;
    }
    const buffer = input.files[entry.name];
    if (!buffer) {
      continue;
    }
    validateMigrationCsvFile(entry.name, buffer, entry, issues);
  }

  return issues;
}
