import { ImportEntityType } from '@prisma/client';

export type ImportJobRowReconcileKeySource = {
  row_no: number;
  external_id: string | null;
  normalized_json: unknown;
};

function normalizedString(normalized: unknown, field: string): string | null {
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    Array.isArray(normalized)
  ) {
    return null;
  }
  const value = (normalized as Record<string, unknown>)[field];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function trackKey(groups: Map<string, number[]>, key: string, rowNo: number) {
  const list = groups.get(key) ?? [];
  list.push(rowNo);
  groups.set(key, list);
}

type RowKeyTracker = (
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
) => void;

function trackExternalId(
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
): void {
  if (row.external_id) {
    trackKey(groups, `ext:${row.external_id}`, row.row_no);
  }
}

function trackCustomerKeys(
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
): void {
  const email = normalizedString(row.normalized_json, 'email');
  if (email) {
    trackKey(groups, `email:${email.toLowerCase()}`, row.row_no);
  }
}

function trackVehicleKeys(
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
): void {
  const vin = normalizedString(row.normalized_json, 'vin');
  if (vin) {
    trackKey(groups, `vin:${vin.toUpperCase()}`, row.row_no);
  }
}

function trackLaborKeys(
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
): void {
  const code = normalizedString(row.normalized_json, 'code');
  if (code) {
    trackKey(groups, `code:${code.toLowerCase()}`, row.row_no);
  }
}

function trackVehicleBoundKeys(
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
): void {
  const vehicleExternal = normalizedString(
    row.normalized_json,
    'vehicle_external_id',
  );
  if (vehicleExternal) {
    trackKey(groups, `vehicle-ext:${vehicleExternal}`, row.row_no);
  }
  const vehicleId = normalizedString(row.normalized_json, 'vehicle_id');
  if (vehicleId) {
    trackKey(groups, `vehicle:${vehicleId}`, row.row_no);
  }
}

function trackSupplierKeys(
  groups: Map<string, number[]>,
  row: ImportJobRowReconcileKeySource,
): void {
  if (row.external_id) {
    trackKey(groups, `article:${row.external_id}`, row.row_no);
  }
}

const ENTITY_ROW_TRACKERS: Partial<Record<ImportEntityType, RowKeyTracker[]>> =
  {
    [ImportEntityType.CUSTOMER]: [trackCustomerKeys],
    [ImportEntityType.VEHICLE]: [trackVehicleKeys],
    [ImportEntityType.LABOR_OPERATION]: [trackLaborKeys],
    [ImportEntityType.SUPPLIER_PRICE_LIST]: [trackSupplierKeys],
    [ImportEntityType.VEHICLE_PARTY]: [trackVehicleBoundKeys],
    [ImportEntityType.VEHICLE_DUE_DATE]: [trackVehicleBoundKeys],
  };

/** Reconcile grouping keys for one persisted import row (matches dry-run group cap rules). */
export function collectReconcileKeyGroups(
  entityType: ImportEntityType,
  rows: ImportJobRowReconcileKeySource[],
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  const trackers = ENTITY_ROW_TRACKERS[entityType] ?? [];
  for (const row of rows) {
    trackExternalId(groups, row);
    for (const tracker of trackers) {
      tracker(groups, row);
    }
  }
  return groups;
}
