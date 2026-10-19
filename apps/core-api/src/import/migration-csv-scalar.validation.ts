import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import type { MigrationValidationIssue } from './migration-manifest.types.js';

const BOOL_PATTERN = /^(true|false)$/;
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,7})\.\d{2}$/;
const QTY_PATTERN = /^(0|[1-9][0-9]{0,7})\.\d{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_PATTERN = /^(19|20)\d{2}$/;

const BOOL_COLUMNS = new Set([
  'has_open_matters',
  'privacy_objection',
  'mail_stop',
  'anonymized',
  'is_active',
  'is_core_part',
  'partially_invoiced',
  'legal_hold',
]);

const MONEY_COLUMNS = new Set([
  'standard_aw',
  'hourly_rate',
  'unit_cost',
  'retail_price',
  'cost_price',
  'core_charge_net',
  'expected_net_total',
  'order_discount_net',
  'net_amount',
  'original_amount',
  'remaining_amount',
  'net_total',
  'vat_total',
  'gross_total',
]);

function invalidScalar(
  message: string,
  field: string,
): MigrationValidationIssue {
  return {
    code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
    message,
    field,
  };
}

function isMoneyColumn(columnName: string): boolean {
  if (MONEY_COLUMNS.has(columnName)) {
    return true;
  }
  return (
    columnName.endsWith('_price') ||
    columnName.endsWith('_net') ||
    columnName.endsWith('_rate')
  );
}

export function validateMigrationCsvScalar(
  field: string,
  value: string,
  columnName: string,
): MigrationValidationIssue | null {
  if (field === 'type' || columnName.endsWith('_role')) {
    return null;
  }
  if (BOOL_COLUMNS.has(columnName)) {
    if (!BOOL_PATTERN.test(value)) {
      return invalidScalar(`${columnName} must be true or false`, columnName);
    }
    return null;
  }
  if (isMoneyColumn(columnName) && columnName !== 'quantity') {
    if (!MONEY_PATTERN.test(value)) {
      return invalidScalar(
        `${columnName} must be a money value with two decimal places`,
        columnName,
      );
    }
    return null;
  }
  if (columnName === 'quantity' && value.includes('.')) {
    if (!QTY_PATTERN.test(value)) {
      return invalidScalar(
        `${columnName} must be a qty value with three decimal places`,
        columnName,
      );
    }
    return null;
  }
  if (columnName.endsWith('_date') || columnName === 'inspected_on') {
    if (!DATE_PATTERN.test(value)) {
      return invalidScalar(`${columnName} must be YYYY-MM-DD`, columnName);
    }
    return null;
  }
  if (columnName === 'year' || columnName.endsWith('_year')) {
    if (!YEAR_PATTERN.test(value)) {
      return invalidScalar(`${columnName} must be a valid year`, columnName);
    }
  }
  return null;
}
