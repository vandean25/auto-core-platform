import { ImportEntityType, ImportRowAction } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { DryRunRowResult, ImportRowIssue } from './import.types.js';

/** Trimmed cell for a canonical field, or '' when the field is not mapped. */
export function cell(
  record: Record<string, string>,
  mapping: Record<string, string>,
  field: string,
): string {
  const column = mapping[field];
  return column ? (record[column]?.trim() ?? '') : '';
}

export function requiredIssue(field: string): ImportRowIssue {
  return {
    code: IMPORT_ERROR_CODES.VALUE_REQUIRED,
    message: `${field} is required`,
    field,
  };
}

export function invalidIssue(field: string, message: string): ImportRowIssue {
  return { code: IMPORT_ERROR_CODES.VALUE_INVALID, message, field };
}

/** `YYYY-MM-DD` calendar day, or null when blank or not a real date. */
export function parseIsoDay(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : null;
}

/** Optional day cell: blank is null, a malformed value adds an issue. */
export function optionalDay(
  raw: string,
  field: string,
  issues: ImportRowIssue[],
): string | null {
  if (raw === '') {
    return null;
  }
  const day = parseIsoDay(raw);
  if (day === null) {
    issues.push(invalidIssue(field, `${field} must be a YYYY-MM-DD date`));
  }
  return day;
}

export function errorRow(
  rowNo: number,
  externalId: string | null,
  errors: ImportRowIssue[],
  warnings: ImportRowIssue[] = [],
): DryRunRowResult {
  return {
    row_no: rowNo,
    external_id: externalId,
    action: ImportRowAction.ERROR,
    entity_id: null,
    errors,
    warnings,
    normalized: null,
  };
}

/** Remembers the first row of an external id; a later row with the same id gets an issue. */
export function duplicateExternalIdIssue(
  seen: Map<string, number>,
  externalId: string,
  rowNo: number,
): ImportRowIssue | null {
  const first = seen.get(externalId);
  seen.set(externalId, first ?? rowNo);
  if (first === undefined) {
    return null;
  }
  return {
    code: IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
    message: `Duplicate external_id in file (first seen on row ${first})`,
    field: 'external_id',
  };
}

/** One CSV row after normalization and reference resolution, before cross-row checks. */
export type PreparedBase<TRow> = {
  rowNo: number;
  externalId: string | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
  action: ImportRowAction;
  entityId: string | null;
  row?: TRow;
  /** Vehicle the row resolved to. */
  vehicleId?: string;
};

/**
 * Normalizes one row and guards its external id against an earlier row of the same file.
 * `resolve` then adds references and target matches to the prepared row.
 */
export function prepareCanonicalRow<TRow extends { external_id: string }>(
  csv: { rowNo: number; record: Record<string, string> },
  mapping: Record<string, string>,
  normalize: (record: Record<string, string>) => {
    row: TRow | null;
    issues: ImportRowIssue[];
  },
  seen: Map<string, number>,
  resolve: (prepared: PreparedBase<TRow>) => void,
): PreparedBase<TRow> {
  const { row, issues } = normalize(csv.record);
  const prepared: PreparedBase<TRow> = {
    rowNo: csv.rowNo,
    externalId:
      (row?.external_id ?? cell(csv.record, mapping, 'external_id')) || null,
    issues,
    warnings: [],
    action: ImportRowAction.CREATE,
    entityId: null,
    row: row ?? undefined,
  };
  if (!row) {
    return prepared;
  }
  const duplicate = duplicateExternalIdIssue(seen, row.external_id, csv.rowNo);
  if (duplicate) {
    issues.push(duplicate);
    return prepared;
  }
  resolve(prepared);
  return prepared;
}

/**
 * Mappings the vehicle-bound canonical files resolve against: external id to entity id per
 * type, plus the vehicles the file mentions.
 */
export async function loadVehicleBoundMappings(
  prisma: PrismaService,
  input: ImportDryRunInput,
  rows: Array<{ record: Record<string, string> }>,
  types: ImportEntityType[],
) {
  const mappings = await prisma.externalIdMapping.findMany({
    where: {
      tenant_id: input.tenantId,
      source_system: input.sourceSystem,
      entity_type: { in: [ImportEntityType.VEHICLE, ...types] },
    },
  });
  const byType = (type: ImportEntityType) =>
    new Map(
      mappings
        .filter((row) => row.entity_type === type)
        .map((row) => [row.external_id, row.entity_id]),
    );
  const vehicleIdByExternalId = byType(ImportEntityType.VEHICLE);
  const vehicleIds = [
    ...new Set(
      rows
        .map((row) =>
          vehicleIdByExternalId.get(
            cell(row.record, input.mapping, 'vehicle_external_id'),
          ),
        )
        .filter((id): id is string => id !== undefined),
    ),
  ];
  return { byType, vehicleIdByExternalId, vehicleIds };
}
