import type { ImportJobOptions, ImportRowIssue } from './import.types.js';
import type { NormalizedVehicleRow } from './vehicle-import.types.js';
import {
  isValidVinCheckDigit,
  isValidVinFormat,
  normalizeVin,
} from './vin.validation.js';
import { readMappedFirstRegistrationDate } from './import-first-registration-date.util.js';

function cellValue(
  record: Record<string, string>,
  mapping: Record<string, string>,
  field: string,
): string {
  const column = mapping[field];
  if (!column) {
    return '';
  }
  return record[column]?.trim() ?? '';
}

function normalizePlate(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, '') ?? '';
  return normalized.length > 0 ? normalized : null;
}

function parseYear(raw: string): number | null {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) {
    return null;
  }
  return parsed;
}

function parseMileage(raw: string): number | null {
  if (!raw.trim()) {
    return null;
  }
  const parsed = Number.parseInt(raw.replace(/\s+/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeVehicleRow(
  record: Record<string, string>,
  mapping: Record<string, string>,
  options: ImportJobOptions,
): {
  row: NormalizedVehicleRow | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
} {
  const issues: ImportRowIssue[] = [];
  const warnings: ImportRowIssue[] = [];

  const externalId = cellValue(record, mapping, 'external_id');
  if (!externalId) {
    issues.push({
      code: 'IMPORT_EXTERNAL_ID_REQUIRED',
      message: 'external_id is required',
      field: 'external_id',
    });
    return { row: null, issues, warnings };
  }

  const vin = normalizeVin(cellValue(record, mapping, 'vin'));
  const plate = normalizePlate(cellValue(record, mapping, 'plate'));

  if (!vin && !options.allow_missing_vin) {
    issues.push({
      code: 'IMPORT_VIN_REQUIRED',
      message: 'vin is required unless allow_missing_vin is enabled',
      field: 'vin',
    });
  }

  if (vin && !isValidVinFormat(vin)) {
    issues.push({
      code: 'IMPORT_VIN_INVALID',
      message: 'vin must be 17 characters using ISO 3779 charset (no I, O, Q)',
      field: 'vin',
    });
  } else if (vin && !isValidVinCheckDigit(vin)) {
    warnings.push({
      code: 'IMPORT_VIN_CHECK_DIGIT',
      message: 'vin check digit does not validate (imported with warning)',
      field: 'vin',
    });
  }

  const make = cellValue(record, mapping, 'make');
  const model = cellValue(record, mapping, 'model');
  const year = parseYear(cellValue(record, mapping, 'year'));

  if (!make) {
    issues.push({
      code: 'IMPORT_MAKE_REQUIRED',
      message: 'make is required',
      field: 'make',
    });
  }
  if (!model) {
    issues.push({
      code: 'IMPORT_MODEL_REQUIRED',
      message: 'model is required',
      field: 'model',
    });
  }
  if (year === null) {
    issues.push({
      code: 'IMPORT_YEAR_INVALID',
      message: 'year must be a valid model year',
      field: 'year',
    });
  }

  const ownerExternalIdRaw = cellValue(
    record,
    mapping,
    'owner_customer_external_id',
  );
  const ownerExternalId = ownerExternalIdRaw || null;
  const firstRegistrationDate = readMappedFirstRegistrationDate(
    record,
    mapping,
    issues,
    warnings,
  );

  if (issues.length > 0) {
    return { row: null, issues, warnings };
  }

  return {
    row: {
      external_id: externalId,
      vin,
      plate,
      make,
      model,
      year: year!,
      mileage: parseMileage(cellValue(record, mapping, 'mileage')),
      color: cellValue(record, mapping, 'color') || null,
      owner_customer_external_id: ownerExternalId,
      owner_external_id_provided: ownerExternalIdRaw.length > 0,
      key_number: cellValue(record, mapping, 'key_number') || null,
      first_registration_date: firstRegistrationDate,
    },
    issues,
    warnings,
  };
}
