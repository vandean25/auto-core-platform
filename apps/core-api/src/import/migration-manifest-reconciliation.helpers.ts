import { MIGRATION_CSV_FILE_SPECS } from './migration-csv-dictionary.js';
import {
  formatMoneyFromCents,
  tryParseMoneyToCents,
} from './migration-money.util.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import type {
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export function manifestListsFile(
  manifest: MigrationManifest,
  fileName: string,
): boolean {
  return manifest.files.some((entry) => entry.name === fileName);
}

export type MigrationReconciliationOptions = {
  allowPartialFiles: boolean;
};

export function pushInvalidMoneyIssue(
  issues: MigrationValidationIssue[],
  value: string,
  ctx: { file?: string; field?: string; row?: number },
): void {
  pushMigrationIssue(issues, {
    code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
    message: `invalid money value "${value}"`,
    file: ctx.file,
    field: ctx.field,
    row: ctx.row,
  });
}

export function sumMoneyStringsSafe(
  values: string[],
  issues: MigrationValidationIssue[],
  ctx: { file?: string; field?: string },
): string | null {
  let total = 0n;
  for (const value of values) {
    const cents = tryParseMoneyToCents(value);
    if (cents === null) {
      pushInvalidMoneyIssue(issues, value, ctx);
      return null;
    }
    total += cents;
  }
  return formatMoneyFromCents(total);
}

export function addMoneyStringsSafe(
  left: string,
  right: string,
  issues: MigrationValidationIssue[],
  ctx: { file?: string; field?: string },
): string | null {
  const leftCents = tryParseMoneyToCents(left);
  const rightCents = tryParseMoneyToCents(right);
  if (leftCents === null) {
    pushInvalidMoneyIssue(issues, left, ctx);
    return null;
  }
  if (rightCents === null) {
    pushInvalidMoneyIssue(issues, right, ctx);
    return null;
  }
  return formatMoneyFromCents(leftCents + rightCents);
}

export function pushControlTotalNotReconciled(
  issues: MigrationValidationIssue[],
  field: string,
  file?: string,
): void {
  pushMigrationIssue(issues, {
    code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_NOT_RECONCILED,
    message:
      'control totals for this file cannot be reconciled until the file is included in the upload',
    field,
    file,
  });
}

export function pushNotReconciledWhenUploadMissing(
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions,
  listed: boolean,
  buffer: Buffer | undefined,
  field: string,
  file?: string,
): boolean {
  if (!options.allowPartialFiles || !listed || buffer) {
    return false;
  }
  pushControlTotalNotReconciled(issues, field, file);
  return true;
}

export function manifestCountsByTypeKeys(
  manifest: MigrationManifest,
): Set<string> {
  return new Set(
    manifest.files.map(
      (entry) => MIGRATION_CSV_FILE_SPECS[entry.name].countsKey,
    ),
  );
}

export function isDeclaredStockValue(
  stockValue: MigrationManifest['control_totals']['stock_value'],
): boolean {
  return stockValue !== null && stockValue !== undefined;
}
