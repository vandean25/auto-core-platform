import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

type AjvValidate = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};
const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => {
  compile: (schema: object) => AjvValidate;
};
const addFormats = addFormatsImport as unknown as (ajv: InstanceType<typeof Ajv2020>) => void;
import { ImportEntityType } from '@prisma/client';
import {
  CANONICAL_MIGRATION_FORMAT_VERSIONS,
  IMPORT_ERROR_CODES,
} from './import.constants.js';
import {
  MIGRATION_CSV_FILE_SPECS,
  MIGRATION_CSV_HANDLED_FILES,
  MIGRATION_CSV_V10_RESERVED_FILES,
  type MigrationCsvFileName,
} from './migration-csv-dictionary.js';
import {
  parseCanonicalMigrationCsv,
  rowToCanonicalRecord,
  sha256Buffer,
} from './migration-csv-parse.util.js';
import {
  MIGRATION_MANIFEST_SCHEMA_V10,
  MIGRATION_MANIFEST_SCHEMA_V11,
} from './migration-manifest.schema.js';

export type MigrationValidationIssue = {
  code: string;
  message: string;
  file?: string;
  row?: number;
  external_id?: string;
  field?: string;
};

export type MigrationManifestFileEntry = {
  name: MigrationCsvFileName;
  sha256: string;
  row_count: number;
};

export type MigrationManifest = {
  format_version: string;
  source_name: string;
  source_system: string;
  source_company_code: string;
  extracted_at: string;
  cutover_date: string;
  currency: string;
  files: MigrationManifestFileEntry[];
  control_totals: Record<string, unknown>;
  assets?: unknown[];
};

export type MigrationBundleInput = {
  manifest: MigrationManifest;
  files: Record<string, Buffer>;
  assets?: Record<string, Buffer>;
  /** When true, only validate files present in `files` (staged wizard uploads). */
  allowPartialFiles?: boolean;
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateV10 = ajv.compile(MIGRATION_MANIFEST_SCHEMA_V10);
const validateV11 = ajv.compile(MIGRATION_MANIFEST_SCHEMA_V11);

const BOOL_PATTERN = /^(true|false)$/;
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,7})\.\d{2}$/;
const QTY_PATTERN = /^(0|[1-9][0-9]{0,7})\.\d{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_PATTERN = /^(19|20)\d{2}$/;

function isMigrationCsvFileName(name: string): name is MigrationCsvFileName {
  return name in MIGRATION_CSV_FILE_SPECS;
}

function pushIssue(
  issues: MigrationValidationIssue[],
  issue: MigrationValidationIssue,
): void {
  issues.push(issue);
}

function validateManifestSchema(
  manifest: MigrationManifest,
  issues: MigrationValidationIssue[],
): void {
  const version = manifest.format_version;
  if (
    !CANONICAL_MIGRATION_FORMAT_VERSIONS.includes(
      version as (typeof CANONICAL_MIGRATION_FORMAT_VERSIONS)[number],
    )
  ) {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_UNSUPPORTED_FORMAT_VERSION,
      message: `Unsupported format_version "${version}"`,
      field: 'format_version',
    });
    return;
  }

  const schemaValidator = version === '1.1' ? validateV11 : validateV10;
  const valid = schemaValidator(manifest);
  if (!valid) {
    const detail = (schemaValidator.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`)
      .join('; ');
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
      message: detail || 'manifest.json failed JSON Schema validation',
      field: 'manifest',
    });
  }
}

function validateSourceSystem(
  manifest: MigrationManifest,
  issues: MigrationValidationIssue[],
): void {
  const expected = `${manifest.source_name}:${manifest.source_company_code}`;
  if (manifest.source_system !== expected) {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_SOURCE_SYSTEM_MISMATCH,
      message: `source_system must be ${expected}, got ${manifest.source_system}`,
      field: 'source_system',
    });
  }
}

function validateBundleFileSet(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  allowPartialFiles: boolean,
): void {
  if (allowPartialFiles) {
    for (const name of Object.keys(files)) {
      if (name === 'manifest.json') {
        continue;
      }
      if (!manifest.files.some((entry) => entry.name === name)) {
        pushIssue(issues, {
          code: IMPORT_ERROR_CODES.MIGRATION_EXTRA_BUNDLE_FILE,
          message: `Bundle contains file not listed in manifest: ${name}`,
          file: name,
        });
      }
    }
    return;
  }
  const manifestNames = manifest.files.map((entry) => entry.name);
  const seen = new Set<string>();
  for (const name of manifestNames) {
    if (seen.has(name)) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_DUPLICATE_FILE_NAME,
        message: `Duplicate manifest files[].name "${name}"`,
        file: name,
      });
    }
    seen.add(name);
  }

  const bundleNames = new Set(
    Object.keys(files).filter((name) => name !== 'manifest.json'),
  );
  for (const name of manifestNames) {
    if (!bundleNames.has(name)) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_MISSING_BUNDLE_FILE,
        message: `Bundle is missing file listed in manifest: ${name}`,
        file: name,
      });
    }
  }
  for (const name of bundleNames) {
    if (!manifestNames.includes(name as MigrationCsvFileName)) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_EXTRA_BUNDLE_FILE,
        message: `Bundle contains file not listed in manifest: ${name}`,
        file: name,
      });
    }
  }
}

function validateReservedFilesForVersion(
  manifest: MigrationManifest,
  issues: MigrationValidationIssue[],
): void {
  if (manifest.format_version !== '1.0') {
    return;
  }
  for (const entry of manifest.files) {
    if (
      MIGRATION_CSV_V10_RESERVED_FILES.includes(
        entry.name as MigrationCsvFileName,
      )
    ) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_RESERVED_FILE_REJECTED,
        message: `${entry.name} is reserved in format_version 1.0 and cannot be supplied`,
        file: entry.name,
      });
    }
  }
}

function validateHandlerCapabilities(
  manifest: MigrationManifest,
  issues: MigrationValidationIssue[],
  filesPresent: Set<string>,
  allowPartialFiles: boolean,
): void {
  const entries = allowPartialFiles
    ? manifest.files.filter((entry) => filesPresent.has(entry.name))
    : manifest.files;
  for (const entry of entries) {
    if (entry.row_count === 0) {
      continue;
    }
    if (
      !MIGRATION_CSV_HANDLED_FILES.includes(entry.name as MigrationCsvFileName)
    ) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY,
        message: `${entry.name} has ${entry.row_count} rows but no import handler is installed`,
        file: entry.name,
      });
    }
  }
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
  const relevantFiles = allowPartialFiles
    ? manifest.files.filter((entry) => filesPresent.has(entry.name))
    : manifest.files;
  const manifestKeys = new Set(
    relevantFiles.map(
      (entry) => MIGRATION_CSV_FILE_SPECS[entry.name].countsKey,
    ),
  );
  const countKeys = new Set(Object.keys(counts));
  for (const key of manifestKeys) {
    if (!countKeys.has(key)) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `counts_by_type is missing key "${key}"`,
        field: 'control_totals.counts_by_type',
      });
    }
  }
  for (const key of countKeys) {
    if (!manifestKeys.has(key)) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `counts_by_type has unexpected key "${key}"`,
        field: 'control_totals.counts_by_type',
      });
    }
  }
  for (const entry of relevantFiles) {
    const key = MIGRATION_CSV_FILE_SPECS[entry.name].countsKey;
    const declared = counts[key];
    if (declared !== entry.row_count) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `counts_by_type.${key} is ${declared}, expected ${entry.row_count}`,
        file: entry.name,
        field: 'control_totals.counts_by_type',
      });
    }
  }
}

function validateStockValue(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const stockEntry = manifest.files.find(
    (entry) => entry.name === 'stock_opening.csv',
  );
  const stockValue = manifest.control_totals.stock_value;
  if (!stockEntry) {
    if (stockValue !== null && stockValue !== undefined) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: 'stock_value must be null when stock_opening.csv is absent',
        field: 'control_totals.stock_value',
      });
    }
    return;
  }
  if (stockValue === null || stockValue === undefined) {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message:
        'stock_value must be provided when stock_opening.csv is supplied',
      field: 'control_totals.stock_value',
    });
    return;
  }
  const buffer = files[stockEntry.name];
  if (!buffer) {
    return;
  }
  const parsed = parseCanonicalMigrationCsv(buffer);
  const computed = computeStockValue(parsed);
  if (computed !== stockValue) {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: `stock_value is ${stockValue}, recomputed ${computed}`,
      field: 'control_totals.stock_value',
      file: 'stock_opening.csv',
    });
  }
}

function roundMoneyHalfUp(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2);
}

function computeStockValue(parsed: ReturnType<typeof parseCanonicalMigrationCsv>) {
  let total = 0;
  const headers = parsed.headers;
  for (const row of parsed.rows) {
    const record = rowToCanonicalRecord(headers, row);
    const qty = Number.parseFloat(record.quantity);
    const unitCost = Number.parseFloat(record.unit_cost);
    if (!Number.isFinite(qty) || !Number.isFinite(unitCost)) {
      continue;
    }
    total += Number.parseFloat(roundMoneyHalfUp(qty * unitCost));
  }
  return roundMoneyHalfUp(total);
}

function validateScalar(
  field: string,
  value: string,
  columnName: string,
): MigrationValidationIssue | null {
  if (field === 'type' || columnName.endsWith('_role')) {
    return null;
  }
  if (
    [
      'has_open_matters',
      'privacy_objection',
      'mail_stop',
      'anonymized',
      'is_active',
      'is_core_part',
      'partially_invoiced',
      'legal_hold',
    ].includes(columnName)
  ) {
    if (!BOOL_PATTERN.test(value)) {
      return {
        code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
        message: `${columnName} must be true or false`,
        field: columnName,
      };
    }
    return null;
  }
  if (
    columnName.endsWith('_price') ||
    columnName.endsWith('_net') ||
    columnName.endsWith('_rate') ||
    columnName === 'standard_aw' ||
    columnName === 'hourly_rate' ||
    columnName === 'unit_cost' ||
    columnName === 'retail_price' ||
    columnName === 'cost_price' ||
    columnName === 'core_charge_net' ||
    columnName === 'expected_net_total' ||
    columnName === 'order_discount_net' ||
    columnName === 'net_amount' ||
    columnName === 'original_amount' ||
    columnName === 'remaining_amount' ||
    columnName === 'net_total' ||
    columnName === 'vat_total' ||
    columnName === 'gross_total'
  ) {
    if (!MONEY_PATTERN.test(value) && columnName !== 'quantity') {
      return {
        code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
        message: `${columnName} must be a money value with two decimal places`,
        field: columnName,
      };
    }
    return null;
  }
  if (columnName === 'quantity' && value.includes('.')) {
    if (!QTY_PATTERN.test(value)) {
      return {
        code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
        message: `${columnName} must be a qty value with three decimal places`,
        field: columnName,
      };
    }
    return null;
  }
  if (columnName.endsWith('_date') || columnName === 'inspected_on') {
    if (!DATE_PATTERN.test(value)) {
      return {
        code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
        message: `${columnName} must be YYYY-MM-DD`,
        field: columnName,
      };
    }
    return null;
  }
  if (columnName === 'year' || columnName.endsWith('_year')) {
    if (!YEAR_PATTERN.test(value)) {
      return {
        code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
        message: `${columnName} must be a valid year`,
        field: columnName,
      };
    }
  }
  return null;
}

function validateCsvFile(
  fileName: MigrationCsvFileName,
  buffer: Buffer,
  entry: MigrationManifestFileEntry,
  issues: MigrationValidationIssue[],
): void {
  const sha256 = sha256Buffer(buffer);
  if (sha256 !== entry.sha256) {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_FILE_HASH_MISMATCH,
      message: `sha256 mismatch for ${fileName}`,
      file: fileName,
      field: 'sha256',
    });
  }

  let parsed;
  try {
    parsed = parseCanonicalMigrationCsv(buffer);
  } catch {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
      message: `${fileName} is not valid UTF-8`,
      file: fileName,
    });
    return;
  }

  if (parsed.rowCount !== entry.row_count) {
    pushIssue(issues, {
      code: IMPORT_ERROR_CODES.MIGRATION_ROW_COUNT_MISMATCH,
      message: `row_count is ${entry.row_count}, parsed ${parsed.rowCount} data rows`,
      file: fileName,
      field: 'row_count',
    });
  }

  const expectedHeaders = MIGRATION_CSV_FILE_SPECS[fileName].columns.map(
    (column) => column.name,
  );
  if (parsed.headers.length === 0 && entry.row_count === 0) {
    if (buffer.length > 0) {
      const headerLine = buffer.toString('utf8').split(/\r?\n/)[0] ?? '';
      const headers = headerLine.split(',');
      validateHeaderOrder(fileName, headers, expectedHeaders, issues);
    }
    return;
  }

  validateHeaderOrder(fileName, parsed.headers, expectedHeaders, issues);

  const specByName = new Map(
    MIGRATION_CSV_FILE_SPECS[fileName].columns.map((column) => [
      column.name,
      column,
    ]),
  );

  for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex += 1) {
    const rowNo = rowIndex + 1;
    const cells = parsed.rows[rowIndex];
    if (cells.length !== expectedHeaders.length) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
        message: `Row ${rowNo} has ${cells.length} cells, expected ${expectedHeaders.length}`,
        file: fileName,
        row: rowNo,
      });
      continue;
    }
    const record = rowToCanonicalRecord(parsed.headers, cells);
    const externalId = record.external_id ?? '';

    for (const [columnName, spec] of specByName) {
      const raw = record[columnName] ?? '';
      const isEmpty = raw.length === 0;
      if (spec.requiredValue && isEmpty) {
        pushIssue(issues, {
          code: IMPORT_ERROR_CODES.MIGRATION_REQUIRED_VALUE_MISSING,
          message: `${columnName} is required`,
          file: fileName,
          row: rowNo,
          external_id: externalId || undefined,
          field: columnName,
        });
        continue;
      }
      if (isEmpty) {
        continue;
      }
      if (spec.enumValues && !spec.enumValues.includes(raw)) {
        pushIssue(issues, {
          code: IMPORT_ERROR_CODES.MIGRATION_UNKNOWN_ENUM_VALUE,
          message: `${columnName} value "${raw}" is not allowed`,
          file: fileName,
          row: rowNo,
          external_id: externalId || undefined,
          field: columnName,
        });
      }
      const scalarIssue = validateScalar(fileName, raw, columnName);
      if (scalarIssue) {
        pushIssue(issues, {
          ...scalarIssue,
          file: fileName,
          row: rowNo,
          external_id: externalId || undefined,
        });
      }
    }

    if (
      fileName === 'vehicles.csv' &&
      (record.engine_code ?? '').length > 0
    ) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY,
        message: 'engine_code is not supported by the vehicle import handler',
        file: fileName,
        row: rowNo,
        external_id: externalId || undefined,
        field: 'engine_code',
      });
    }
  }
}

function validateHeaderOrder(
  fileName: MigrationCsvFileName,
  headers: string[],
  expected: string[],
  issues: MigrationValidationIssue[],
): void {
  if (headers.length !== expected.length) {
    const missing = expected.filter((header) => !headers.includes(header));
    if (missing.length > 0) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_MISSING_REQUIRED_COLUMN,
        message: `Missing required column(s): ${missing.join(', ')}`,
        file: fileName,
      });
    }
    const unknown = headers.filter((header) => !expected.includes(header));
    if (unknown.length > 0) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_UNKNOWN_COLUMN,
        message: `Unknown column(s): ${unknown.join(', ')}`,
        file: fileName,
      });
    }
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (headers[index] !== expected[index]) {
      pushIssue(issues, {
        code: IMPORT_ERROR_CODES.MIGRATION_HEADER_ORDER_MISMATCH,
        message: `Header column ${index + 1} must be ${expected[index]}, got ${headers[index] ?? '(missing)'}`,
        file: fileName,
        field: expected[index],
      });
      break;
    }
  }
}

export function parseMigrationManifestJson(
  buffer: Buffer,
): MigrationManifest {
  const text = buffer.toString('utf8');
  return JSON.parse(text) as MigrationManifest;
}

export function validateMigrationBundle(
  input: MigrationBundleInput,
): MigrationValidationIssue[] {
  const issues: MigrationValidationIssue[] = [];
  const manifest = input.manifest;

  validateManifestSchema(manifest, issues);
  if (
    issues.some(
      (issue) =>
        issue.code === IMPORT_ERROR_CODES.MIGRATION_UNSUPPORTED_FORMAT_VERSION,
    )
  ) {
    return issues;
  }

  validateSourceSystem(manifest, issues);
  validateBundleFileSet(
    manifest,
    input.files,
    issues,
    input.allowPartialFiles === true,
  );
  validateReservedFilesForVersion(manifest, issues);
  const filesPresent = new Set(Object.keys(input.files));
  validateCountsByType(
    manifest,
    issues,
    filesPresent,
    input.allowPartialFiles === true,
  );
  validateStockValue(manifest, input.files, issues);
  validateHandlerCapabilities(
    manifest,
    issues,
    filesPresent,
    input.allowPartialFiles === true,
  );

  for (const entry of manifest.files) {
    if (!isMigrationCsvFileName(entry.name)) {
      continue;
    }
    const buffer = input.files[entry.name];
    if (!buffer) {
      if (input.allowPartialFiles) {
        continue;
      }
      continue;
    }
    validateCsvFile(entry.name, buffer, entry, issues);
  }

  return issues;
}

export function assertMigrationBundleValid(input: MigrationBundleInput): void {
  const issues = validateMigrationBundle(input);
  if (issues.length > 0) {
    const error = new Error(issues[0]?.message ?? 'Migration bundle invalid');
    (error as Error & { issues: MigrationValidationIssue[] }).issues = issues;
    throw error;
  }
}

export function canonicalMigrationEntityForFile(
  fileName: MigrationCsvFileName,
): ImportEntityType | null {
  if (fileName === 'customers.csv') {
    return ImportEntityType.CUSTOMER;
  }
  if (fileName === 'vehicles.csv') {
    return ImportEntityType.VEHICLE;
  }
  if (fileName === 'labor_operations.csv') {
    return ImportEntityType.LABOR_OPERATION;
  }
  return null;
}
