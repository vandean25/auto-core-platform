import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import type { MigrationCsvFileName } from './migration-csv-dictionary.js';
import type { MigrationValidationIssue } from './migration-manifest.types.js';

export function pushCsvHandlerCapabilityIssues(
  fileName: MigrationCsvFileName,
  record: Record<string, string>,
  rowNo: number,
  externalId: string,
  issues: MigrationValidationIssue[],
): void {
  if (fileName === 'vehicles.csv') {
    if ((record.engine_code ?? '').length > 0) {
      issues.push({
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY,
        message: 'engine_code is not supported by the vehicle import handler',
        file: fileName,
        row: rowNo,
        external_id: externalId || undefined,
        field: 'engine_code',
      });
    }
    const role = record.inventory_role ?? '';
    if (role.length > 0 && role !== 'CUSTOMER') {
      issues.push({
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY,
        message: `inventory_role "${role}" is not supported by the vehicle import handler`,
        file: fileName,
        row: rowNo,
        external_id: externalId || undefined,
        field: 'inventory_role',
      });
    }
  }

  if (
    fileName === 'customers.csv' &&
    (record.anonymized ?? '').toLowerCase() === 'true'
  ) {
    issues.push({
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY,
      message:
        'anonymized=true is not supported by the customer import handler',
      file: fileName,
      row: rowNo,
      external_id: externalId || undefined,
      field: 'anonymized',
    });
  }
}
