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
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import type {
  MigrationBundleInput,
  MigrationManifestFileEntry,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export type {
  MigrationBundleInput,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

function isMigrationCsvFileName(name: string): name is MigrationCsvFileName {
  return name in MIGRATION_CSV_FILE_SPECS;
}

function validateManifestEntryAgainstStats(
  entry: MigrationManifestFileEntry,
  stats: { sha256: string; rowCount: number },
  issues: MigrationValidationIssue[],
): void {
  if (stats.sha256 !== entry.sha256) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_FILE_HASH_MISMATCH,
      message: `sha256 mismatch for ${entry.name}`,
      file: entry.name,
      field: 'sha256',
    });
  }
  if (stats.rowCount !== entry.row_count) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_ROW_COUNT_MISMATCH,
      message: `row_count is ${entry.row_count}, parsed ${stats.rowCount} data rows`,
      file: entry.name,
      field: 'row_count',
    });
  }
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

  const filesPresent = new Set([
    ...Object.keys(input.files),
    ...(input.presentFileNames ?? []),
  ]);
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
    const stats = input.presentFileStats?.[entry.name];
    if (!buffer && stats) {
      validateManifestEntryAgainstStats(entry, stats, issues);
      continue;
    }
    if (!buffer) {
      continue;
    }
    validateMigrationCsvFile(entry.name, buffer, entry, issues);
  }

  return issues;
}
