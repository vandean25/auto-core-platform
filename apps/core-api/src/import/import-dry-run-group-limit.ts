import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { cell } from './canonical-csv-cell.util.js';
import { rowToRecord, type ParsedCsv } from './csv-parse.util.js';
import { dryRunRowNoForSlice } from './import-dry-run-plan-budget.js';
import type { ImportDryRunPlanBudget } from './import-type-handler.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { DryRunRowResult } from './import.types.js';

/** Max rows per reconcile group (vehicle party block, duplicate-key span, etc.). */
export const IMPORT_RECONCILE_GROUP_MAX_ROWS = 1000;

export function dryRunImportGroupTooLargeRow(
  rowNo: number,
  externalId: string | null,
): DryRunRowResult {
  return {
    row_no: rowNo,
    external_id: externalId,
    action: ImportRowAction.ERROR,
    entity_id: null,
    errors: [
      {
        code: IMPORT_ERROR_CODES.GROUP_TOO_LARGE,
        message: `Import group exceeds ${IMPORT_RECONCILE_GROUP_MAX_ROWS} rows; split the file`,
      },
    ],
    warnings: [],
    normalized: null,
  };
}

function trackKey(groups: Map<string, number[]>, key: string, rowNo: number) {
  const list = groups.get(key) ?? [];
  list.push(rowNo);
  groups.set(key, list);
}

function trackParsedCsvRowEntity(
  groups: Map<string, number[]>,
  entityType: ImportEntityType,
  record: Record<string, string>,
  mapping: Record<string, string>,
  rowNo: number,
) {
  switch (entityType) {
    case ImportEntityType.CUSTOMER: {
      const email = cell(record, mapping, 'email').trim().toLowerCase();
      if (email) {
        trackKey(groups, `email:${email}`, rowNo);
      }
      return;
    }
    case ImportEntityType.VEHICLE: {
      const vin = cell(record, mapping, 'vin').trim().toUpperCase();
      if (vin) {
        trackKey(groups, `vin:${vin}`, rowNo);
      }
      return;
    }
    case ImportEntityType.LABOR_OPERATION: {
      const code = cell(record, mapping, 'code').trim().toLowerCase();
      if (code) {
        trackKey(groups, `code:${code}`, rowNo);
      }
      return;
    }
    case ImportEntityType.SUPPLIER_PRICE_LIST: {
      const article = cell(record, mapping, 'supplier_article_no');
      if (article) {
        trackKey(groups, `article:${article}`, rowNo);
      }
      return;
    }
    case ImportEntityType.VEHICLE_PARTY:
    case ImportEntityType.VEHICLE_DUE_DATE: {
      const vehicleExternal = cell(record, mapping, 'vehicle_external_id');
      if (vehicleExternal) {
        trackKey(groups, `vehicle-ext:${vehicleExternal}`, rowNo);
      }
      return;
    }
    default:
      return;
  }
}

function collectGroupsFromParsedCsv(
  parsed: ParsedCsv,
  mapping: Record<string, string>,
  entityType: ImportEntityType,
  budget?: ImportDryRunPlanBudget,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < parsed.rows.length; index++) {
    const rowNo = dryRunRowNoForSlice(budget, index);
    const record = rowToRecord(parsed.headers, parsed.rows[index]);
    const externalId = mapping.external_id
      ? cell(record, mapping, 'external_id') || null
      : null;
    if (externalId) {
      trackKey(groups, `ext:${externalId}`, rowNo);
    }
    trackParsedCsvRowEntity(groups, entityType, record, mapping, rowNo);
  }
  return groups;
}

export function oversizedImportGroupRowNos(
  groups: Map<string, number[]>,
  maxRows = IMPORT_RECONCILE_GROUP_MAX_ROWS,
): Set<number> {
  const oversized = new Set<number>();
  for (const rowNos of groups.values()) {
    if (rowNos.length > maxRows) {
      for (const rowNo of rowNos) {
        oversized.add(rowNo);
      }
    }
  }
  return oversized;
}

export function guardDryRunGroupCap(
  oversized: Set<number>,
  rowNo: number,
  externalId: string | null,
  plan: () => DryRunRowResult,
): DryRunRowResult {
  if (oversized.has(rowNo)) {
    return dryRunImportGroupTooLargeRow(rowNo, externalId);
  }
  return plan();
}

export function oversizedRowNosFromParsedCsv(
  parsed: ParsedCsv,
  mapping: Record<string, string>,
  entityType: ImportEntityType,
  budget?: ImportDryRunPlanBudget,
): Set<number> {
  return oversizedImportGroupRowNos(
    collectGroupsFromParsedCsv(parsed, mapping, entityType, budget),
  );
}
