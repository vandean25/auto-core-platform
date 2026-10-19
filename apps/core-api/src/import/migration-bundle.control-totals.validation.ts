import { MIGRATION_CSV_FILE_SPECS } from './migration-csv-dictionary.js';
import { parseCanonicalMigrationCsv } from './migration-csv-parse.util.js';
import {
  isDeclaredStockValue,
  manifestCountsByTypeKeys,
  pushControlTotalNotReconciled,
} from './migration-manifest-reconciliation.helpers.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import { computeMigrationStockValue } from './migration-stock-value.util.js';
import type {
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

function pushUnexpectedCountsByTypeKey(
  issues: MigrationValidationIssue[],
  key: string,
): void {
  pushMigrationIssue(issues, {
    code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
    message: `counts_by_type has unexpected key "${key}"`,
    field: 'control_totals.counts_by_type',
  });
}

function pushCountsByTypeMismatch(
  issues: MigrationValidationIssue[],
  key: string,
  declared: number,
  expected: number,
  file: string,
): void {
  pushMigrationIssue(issues, {
    code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
    message: `counts_by_type.${key} is ${declared}, expected ${expected}`,
    file,
    field: 'control_totals.counts_by_type',
  });
}

function validateCountsByType(
  manifest: MigrationManifest,
  issues: MigrationValidationIssue[],
  filesPresent: Set<string>,
  allowPartialFiles: boolean,
): void {
  const counts = manifest.control_totals.counts_by_type as Record<
    string,
    number
  >;
  if (!counts || typeof counts !== 'object') {
    return;
  }
  const manifestKeys = manifestCountsByTypeKeys(manifest);
  for (const key of Object.keys(counts)) {
    if (!manifestKeys.has(key)) {
      pushUnexpectedCountsByTypeKey(issues, key);
    }
  }
  if (!allowPartialFiles) {
    for (const key of manifestKeys) {
      if (!Object.prototype.hasOwnProperty.call(counts, key)) {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: `counts_by_type is missing key "${key}"`,
          field: 'control_totals.counts_by_type',
        });
      }
    }
  }
  for (const entry of manifest.files) {
    const key = MIGRATION_CSV_FILE_SPECS[entry.name].countsKey;
    const declared = counts[key];
    if (allowPartialFiles && !filesPresent.has(entry.name)) {
      if (declared !== entry.row_count) {
        pushControlTotalNotReconciled(
          issues,
          'control_totals.counts_by_type',
          entry.name,
        );
      }
      continue;
    }
    if (!allowPartialFiles && !filesPresent.has(entry.name)) {
      continue;
    }
    if (declared !== entry.row_count) {
      pushCountsByTypeMismatch(
        issues,
        key,
        declared,
        entry.row_count,
        entry.name,
      );
    }
  }
}

function validateStockValue(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  allowPartialFiles: boolean,
): void {
  const stockEntry = manifest.files.find(
    (entry) => entry.name === 'stock_opening.csv',
  );
  const stockValue = manifest.control_totals.stock_value;
  if (!stockEntry) {
    if (isDeclaredStockValue(stockValue)) {
      if (allowPartialFiles) {
        pushControlTotalNotReconciled(issues, 'control_totals.stock_value');
      } else {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: 'stock_value must be null when stock_opening.csv is absent',
          field: 'control_totals.stock_value',
        });
      }
    }
    return;
  }
  if (!isDeclaredStockValue(stockValue)) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message:
        'stock_value must be provided when stock_opening.csv is supplied',
      field: 'control_totals.stock_value',
    });
    return;
  }
  const buffer = files[stockEntry.name];
  if (!buffer) {
    if (allowPartialFiles) {
      pushControlTotalNotReconciled(
        issues,
        'control_totals.stock_value',
        'stock_opening.csv',
      );
    }
    return;
  }
  const parsed = parseCanonicalMigrationCsv(buffer);
  const computed = computeMigrationStockValue(parsed);
  const declaredStockValue =
    typeof stockValue === 'string' || typeof stockValue === 'number'
      ? String(stockValue)
      : JSON.stringify(stockValue);
  if (computed !== declaredStockValue) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: `stock_value is ${declaredStockValue}, recomputed ${computed}`,
      field: 'control_totals.stock_value',
      file: 'stock_opening.csv',
    });
  }
}

export function validateMigrationBundleControlTotals(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  allowPartialFiles: boolean,
): void {
  const filesPresent = new Set(Object.keys(files));
  validateCountsByType(manifest, issues, filesPresent, allowPartialFiles);
  validateStockValue(manifest, files, issues, allowPartialFiles);
}
