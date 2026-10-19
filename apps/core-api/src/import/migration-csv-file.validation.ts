import {
  MIGRATION_CSV_FILE_SPECS,
  type MigrationCsvFileName,
} from './migration-csv-dictionary.js';
import {
  parseCanonicalMigrationCsv,
  rowToCanonicalRecord,
  sha256Buffer,
} from './migration-csv-parse.util.js';
import { pushCsvHandlerCapabilityIssues } from './migration-csv-handler-capability.validation.js';
import { validateMigrationCsvHeaderOrder } from './migration-csv-header.validation.js';
import { validateMigrationCsvScalar } from './migration-csv-scalar.validation.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import type {
  MigrationManifestFileEntry,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export function validateMigrationCsvFile(
  fileName: MigrationCsvFileName,
  buffer: Buffer,
  entry: MigrationManifestFileEntry,
  issues: MigrationValidationIssue[],
): void {
  const sha256 = sha256Buffer(buffer);
  if (sha256 !== entry.sha256) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_FILE_HASH_MISMATCH,
      message: `sha256 mismatch for ${fileName}`,
      file: fileName,
      field: 'sha256',
    });
  }

  let parsed: ReturnType<typeof parseCanonicalMigrationCsv>;
  try {
    parsed = parseCanonicalMigrationCsv(buffer);
  } catch {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
      message: `${fileName} is not valid UTF-8`,
      file: fileName,
    });
    return;
  }

  if (parsed.rowCount !== entry.row_count) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_ROW_COUNT_MISMATCH,
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
      validateMigrationCsvHeaderOrder(
        fileName,
        headers,
        expectedHeaders,
        issues,
      );
    }
    return;
  }

  validateMigrationCsvHeaderOrder(
    fileName,
    parsed.headers,
    expectedHeaders,
    issues,
  );

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
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
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
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_REQUIRED_VALUE_MISSING,
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
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNKNOWN_ENUM_VALUE,
          message: `${columnName} value "${raw}" is not allowed`,
          file: fileName,
          row: rowNo,
          external_id: externalId || undefined,
          field: columnName,
        });
      }
      const scalarIssue = validateMigrationCsvScalar(fileName, raw, columnName);
      if (scalarIssue) {
        pushMigrationIssue(issues, {
          ...scalarIssue,
          file: fileName,
          row: rowNo,
          external_id: externalId || undefined,
        });
      }
    }

    pushCsvHandlerCapabilityIssues(
      fileName,
      record,
      rowNo,
      externalId,
      issues,
    );
  }
}
