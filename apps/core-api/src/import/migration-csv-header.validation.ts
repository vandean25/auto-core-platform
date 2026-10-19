import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import type { MigrationCsvFileName } from './migration-csv-dictionary.js';
import type { MigrationValidationIssue } from './migration-manifest.types.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';

export function validateMigrationCsvHeaderOrder(
  fileName: MigrationCsvFileName,
  headers: string[],
  expected: string[],
  issues: MigrationValidationIssue[],
): void {
  if (headers.length !== expected.length) {
    const missing = expected.filter((header) => !headers.includes(header));
    if (missing.length > 0) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MISSING_REQUIRED_COLUMN,
        message: `Missing required column(s): ${missing.join(', ')}`,
        file: fileName,
      });
    }
    const unknown = headers.filter((header) => !expected.includes(header));
    if (unknown.length > 0) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNKNOWN_COLUMN,
        message: `Unknown column(s): ${unknown.join(', ')}`,
        file: fileName,
      });
    }
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (headers[index] !== expected[index]) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_HEADER_ORDER_MISMATCH,
        message: `Header column ${index + 1} must be ${expected[index]}, got ${headers[index] ?? '(missing)'}`,
        file: fileName,
        field: expected[index],
      });
      break;
    }
  }
}
