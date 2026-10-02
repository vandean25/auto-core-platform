import { ImportRowAction } from '@prisma/client';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportRowIssue,
  NormalizedVehicleRow,
} from './import.types.js';
import {
  isValidVinCheckDigit,
  isValidVinFormat,
  normalizeVin,
} from './vin.validation.js';
import { normalizeVehicleIdentityValueOrNull } from '../vehicle/vehicle-identity.util.js';
import { recordsEqual } from './customer-import.logic.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

export type VehicleMatchContext = {
  mappingByExternalId: Map<string, string>;
  vehicleByVin: Map<string, string>;
  vehicleByPlate: Map<string, string>;
  vehicleById: Map<string, Record<string, unknown>>;
  customerExternalToEntityId: Map<string, string>;
  vinSeenInFile: Map<string, number>;
  externalIdSeenInFile: Map<string, number>;
};

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
    },
    issues,
    warnings,
  };
}

export function vehicleComparableForUpdate(
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  const ownerProvided = normalized.owner_external_id_provided === true;
  return Object.fromEntries(
    Object.entries({
      make: normalized.make,
      model: normalized.model,
      year: normalized.year,
      vin: normalized.vin,
      plate: normalized.plate,
      mileage: normalized.mileage,
      color: normalized.color,
      key_number: normalized.key_number,
      ...(ownerProvided ? { customer_id: normalized.customer_id } : {}),
    }).filter(([, value]) => value !== null && value !== ''),
  );
}

function buildVehiclePayload(
  row: NormalizedVehicleRow,
  customerId: string | null,
) {
  return {
    make: row.make,
    model: row.model,
    year: row.year,
    vin: row.vin,
    plate: normalizeVehicleIdentityValueOrNull(row.plate),
    mileage: row.mileage,
    color: row.color,
    key_number: row.key_number,
    customer_id: customerId,
    owner_external_id_provided: row.owner_external_id_provided,
  };
}

export function planVehicleDryRunRow(
  rowNo: number,
  row: NormalizedVehicleRow,
  context: VehicleMatchContext,
  options: ImportJobOptions,
  warnings: ImportRowIssue[],
): DryRunRowResult {
  const issues: ImportRowIssue[] = [];

  const priorExternalRow = context.externalIdSeenInFile.get(row.external_id);
  if (priorExternalRow !== undefined && priorExternalRow !== rowNo) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: [
        {
          code: IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
          message: `Duplicate external_id in file (first seen on row ${priorExternalRow})`,
          field: 'external_id',
        },
      ],
      warnings,
      normalized: null,
    };
  }
  context.externalIdSeenInFile.set(row.external_id, rowNo);

  if (row.vin) {
    const firstRow = context.vinSeenInFile.get(row.vin);
    if (firstRow !== undefined && firstRow !== rowNo) {
      return {
        row_no: rowNo,
        external_id: row.external_id,
        action: ImportRowAction.ERROR,
        entity_id: null,
        errors: [
          {
            code: 'IMPORT_DUPLICATE_VIN_IN_FILE',
            message: `Duplicate VIN in file (first seen on row ${firstRow})`,
            field: 'vin',
          },
        ],
        warnings,
        normalized: null,
      };
    }
    context.vinSeenInFile.set(row.vin, rowNo);
  }

  let customerId: string | null = null;
  if (row.owner_customer_external_id) {
    customerId =
      context.customerExternalToEntityId.get(row.owner_customer_external_id) ??
      null;
    if (!customerId) {
      return {
        row_no: rowNo,
        external_id: row.external_id,
        action: ImportRowAction.ERROR,
        entity_id: null,
        errors: [
          {
            code: 'IMPORT_UNKNOWN_OWNER',
            message:
              'owner customer external_id does not resolve in this tenant',
            field: 'owner_customer_external_id',
          },
        ],
        warnings,
        normalized: null,
      };
    }
  }

  let entityId = context.mappingByExternalId.get(row.external_id) ?? null;
  let matchedBy: 'external_id' | 'vin' | 'plate' | null = entityId
    ? 'external_id'
    : null;

  if (!entityId && row.vin) {
    entityId = context.vehicleByVin.get(row.vin) ?? null;
    matchedBy = entityId ? 'vin' : matchedBy;
  }

  if (!entityId && !row.vin && row.plate) {
    entityId = context.vehicleByPlate.get(row.plate) ?? null;
    if (entityId) {
      matchedBy = 'plate';
      warnings.push({
        code: 'IMPORT_MATCHED_BY_PLATE',
        message: 'Vehicle matched by plate because VIN is empty',
        field: 'plate',
      });
    }
  }

  const payload = buildVehiclePayload(row, customerId);
  const normalized = { ...payload, external_id: row.external_id };

  if (!entityId) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.CREATE,
      entity_id: null,
      errors: [],
      warnings,
      normalized,
    };
  }

  if (!options.update_existing) {
    if (matchedBy) {
      warnings.push({
        code: 'IMPORT_EXISTING_NOT_UPDATED',
        message: 'Existing vehicle matched but update_existing is false',
      });
    }
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.SKIP,
      entity_id: entityId,
      errors: [],
      warnings,
      normalized,
    };
  }

  const existing = context.vehicleById.get(entityId);
  if (existing) {
    const comparable = vehicleComparableForUpdate(normalized);
    const unchanged = recordsEqual(
      existing,
      comparable,
      options.fill_empty_only === true,
    );
    if (unchanged) {
      return {
        row_no: rowNo,
        external_id: row.external_id,
        action: ImportRowAction.SKIP,
        entity_id: entityId,
        errors: [],
        warnings,
        normalized,
      };
    }
  }

  return {
    row_no: rowNo,
    external_id: row.external_id,
    action: ImportRowAction.UPDATE,
    entity_id: entityId,
    errors: issues,
    warnings,
    normalized,
  };
}
