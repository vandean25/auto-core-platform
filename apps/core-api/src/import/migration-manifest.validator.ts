import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

type AjvValidate = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};
const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => {
  compile: (schema: object) => AjvValidate;
};
const addFormats = addFormatsImport as unknown as (
  ajv: InstanceType<typeof Ajv2020>,
) => void;
import { ImportEntityType } from '@prisma/client';
import { CANONICAL_MIGRATION_FORMAT_VERSIONS } from './canonical-migration.constants.js';
import {
  MIGRATION_CSV_FILE_SPECS,
  MIGRATION_CSV_HANDLED_FILES,
  MIGRATION_CSV_V10_RESERVED_FILES,
  type MigrationCsvFileName,
} from './migration-csv-dictionary.js';
import { parseCanonicalMigrationCsv } from './migration-csv-parse.util.js';
import {
  computeMigrationStockValue,
  validateMigrationCsvFile,
} from './migration-manifest-csv.validation.js';
import { validateMigrationManifestReconciliationV11 } from './migration-manifest-reconciliation.v11.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import {
  MIGRATION_MANIFEST_SCHEMA_V10,
  MIGRATION_MANIFEST_SCHEMA_V11,
} from './migration-manifest.schema.js';
import type {
  MigrationBundleInput,
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export type {
  MigrationBundleInput,
  MigrationManifest,
  MigrationManifestFileEntry,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateV10 = ajv.compile(MIGRATION_MANIFEST_SCHEMA_V10);
const validateV11 = ajv.compile(MIGRATION_MANIFEST_SCHEMA_V11);

function isMigrationCsvFileName(name: string): name is MigrationCsvFileName {
  return name in MIGRATION_CSV_FILE_SPECS;
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
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_FORMAT_VERSION,
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
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
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
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_SOURCE_SYSTEM_MISMATCH,
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
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_EXTRA_BUNDLE_FILE,
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
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_DUPLICATE_FILE_NAME,
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
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MISSING_BUNDLE_FILE,
        message: `Bundle is missing file listed in manifest: ${name}`,
        file: name,
      });
    }
  }
  for (const name of bundleNames) {
    if (!manifestNames.includes(name as MigrationCsvFileName)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_EXTRA_BUNDLE_FILE,
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
    if (MIGRATION_CSV_V10_RESERVED_FILES.includes(entry.name)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_RESERVED_FILE_REJECTED,
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
    if (!MIGRATION_CSV_HANDLED_FILES.includes(entry.name)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY,
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
  if (allowPartialFiles) {
    for (const entry of manifest.files) {
      if (!filesPresent.has(entry.name)) {
        continue;
      }
      const key = MIGRATION_CSV_FILE_SPECS[entry.name].countsKey;
      const declared = counts[key];
      if (declared !== entry.row_count) {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: `counts_by_type.${key} is ${declared}, expected ${entry.row_count}`,
          file: entry.name,
          field: 'control_totals.counts_by_type',
        });
      }
    }
    return;
  }
  const relevantFiles = manifest.files;
  const manifestKeys = new Set(
    relevantFiles.map(
      (entry) => MIGRATION_CSV_FILE_SPECS[entry.name].countsKey,
    ),
  );
  const countKeys = new Set(Object.keys(counts));
  for (const key of manifestKeys) {
    if (!countKeys.has(key)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `counts_by_type is missing key "${key}"`,
        field: 'control_totals.counts_by_type',
      });
    }
  }
  for (const key of countKeys) {
    if (!manifestKeys.has(key)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `counts_by_type has unexpected key "${key}"`,
        field: 'control_totals.counts_by_type',
      });
    }
  }
  for (const entry of relevantFiles) {
    const key = MIGRATION_CSV_FILE_SPECS[entry.name].countsKey;
    const declared = counts[key];
    if (declared !== entry.row_count) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
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
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: 'stock_value must be null when stock_opening.csv is absent',
        field: 'control_totals.stock_value',
      });
    }
    return;
  }
  if (stockValue === null || stockValue === undefined) {
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

export function parseMigrationManifestJson(buffer: Buffer): MigrationManifest {
  const text = buffer.toString('utf8');
  try {
    return JSON.parse(text) as MigrationManifest;
  } catch {
    const error = new SyntaxError('manifest.json is not valid JSON');
    (error as Error & { code: string }).code =
      MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID;
    throw error;
  }
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
        issue.code ===
        MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_FORMAT_VERSION,
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
  if (input.allowPartialFiles !== true) {
    validateStockValue(manifest, input.files, issues);
    validateMigrationManifestReconciliationV11(
      manifest,
      input.files,
      input.assets ?? {},
      issues,
    );
  }
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
      continue;
    }
    validateMigrationCsvFile(entry.name, buffer, entry, issues);
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
