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
import { CANONICAL_MIGRATION_FORMAT_VERSIONS } from './canonical-migration.constants.js';
import {
  MIGRATION_CSV_HANDLED_FILES,
  MIGRATION_CSV_V10_RESERVED_FILES,
  type MigrationCsvFileName,
} from './migration-csv-dictionary.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import {
  MIGRATION_MANIFEST_SCHEMA_V10,
  MIGRATION_MANIFEST_SCHEMA_V11,
} from './migration-manifest.schema.js';
import type {
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateV10 = ajv.compile(MIGRATION_MANIFEST_SCHEMA_V10);
const validateV11 = ajv.compile(MIGRATION_MANIFEST_SCHEMA_V11);

export function validateMigrationManifestSchema(
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

export function validateMigrationSourceSystem(
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

export function validateMigrationBundleFileSet(
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

export function validateMigrationReservedFilesForVersion(
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

export function validateMigrationHandlerCapabilities(
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
