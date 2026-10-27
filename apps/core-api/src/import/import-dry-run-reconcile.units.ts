import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';

type RowSpan = { min_row: number; max_row: number };
type SpanEntry = RowSpan & { count: number; row_nos: number[] };
type SpanTracker = Map<string, SpanEntry>;

function spansImportBatches(span: RowSpan, batchSize: number): boolean {
  const firstBatch = Math.floor((span.min_row - 1) / batchSize);
  const lastBatch = Math.floor((span.max_row - 1) / batchSize);
  return firstBatch !== lastBatch;
}

function trackKey(tracker: SpanTracker, key: string, rowNo: number): void {
  const existing = tracker.get(key);
  if (!existing) {
    tracker.set(key, {
      min_row: rowNo,
      max_row: rowNo,
      count: 1,
      row_nos: [rowNo],
    });
    return;
  }
  existing.min_row = Math.min(existing.min_row, rowNo);
  existing.max_row = Math.max(existing.max_row, rowNo);
  existing.count += 1;
  existing.row_nos.push(rowNo);
}

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

function trackNormalizedField(
  tracker: SpanTracker,
  normalized: unknown,
  field: string,
  rowNo: number,
  lowercase = false,
): void {
  const raw = normalizedString(normalized, field);
  if (!raw) {
    return;
  }
  trackKey(tracker, lowercase ? raw.toLowerCase() : raw, rowNo);
}

function unitFromDuplicateSpan(span: SpanEntry): ImportDryRunReconcileUnit {
  const replan = [...span.row_nos].sort((a, b) => a - b);
  return {
    context_from_row: span.min_row,
    context_to_row: span.max_row,
    replan_row_nos: replan,
  };
}

type ReconcileRow = {
  row_no: number;
  external_id: string | null;
  normalized_json: unknown;
};

function trackVehicleIdGroup(
  row: ReconcileRow,
  vehicleRowNos: Map<string, number[]>,
): void {
  const vehicleId = normalizedString(row.normalized_json, 'vehicle_id');
  if (!vehicleId) {
    return;
  }
  const list = vehicleRowNos.get(vehicleId) ?? [];
  list.push(row.row_no);
  vehicleRowNos.set(vehicleId, list);
}

const SECONDARY_SPAN_BY_ENTITY: Partial<
  Record<
    ImportEntityType,
    (row: ReconcileRow, secondarySpans: SpanTracker) => void
  >
> = {
  [ImportEntityType.CUSTOMER]: (row, secondarySpans) =>
    trackNormalizedField(
      secondarySpans,
      row.normalized_json,
      'email',
      row.row_no,
      true,
    ),
  [ImportEntityType.VEHICLE]: (row, secondarySpans) =>
    trackNormalizedField(
      secondarySpans,
      row.normalized_json,
      'vin',
      row.row_no,
      true,
    ),
  [ImportEntityType.LABOR_OPERATION]: (row, secondarySpans) =>
    trackNormalizedField(
      secondarySpans,
      row.normalized_json,
      'code',
      row.row_no,
      true,
    ),
  [ImportEntityType.SUPPLIER_PRICE_LIST]: (row, secondarySpans) => {
    if (row.external_id) {
      trackKey(secondarySpans, row.external_id, row.row_no);
    }
  },
};

/** Cross-batch reconcile units: only row numbers that may need overwrite, with a bounded context window. */
export async function computeImportDryRunReconcileUnits(
  prisma: PrismaService,
  params: {
    tenantId: string;
    jobId: string;
    entityType: ImportEntityType;
    batchSize: number;
  },
): Promise<ImportDryRunReconcileUnit[]> {
  const rows = await prisma.importJobRow.findMany({
    where: {
      tenant_id: params.tenantId,
      import_job_id: params.jobId,
    },
    select: {
      row_no: true,
      external_id: true,
      normalized_json: true,
    },
    orderBy: { row_no: 'asc' },
  });

  const externalIdSpans: SpanTracker = new Map();
  const secondarySpans: SpanTracker = new Map();
  const vehicleRowNos = new Map<string, number[]>();

  for (const row of rows) {
    if (row.external_id) {
      trackKey(externalIdSpans, row.external_id, row.row_no);
    }
    SECONDARY_SPAN_BY_ENTITY[params.entityType]?.(row, secondarySpans);
    if (
      params.entityType === ImportEntityType.VEHICLE_PARTY ||
      params.entityType === ImportEntityType.VEHICLE_DUE_DATE
    ) {
      trackVehicleIdGroup(row, vehicleRowNos);
    }
  }

  const units = [
    ...unitsFromSpanTracker(externalIdSpans, params.batchSize),
    ...unitsFromSpanTracker(secondarySpans, params.batchSize),
    ...unitsFromVehicleGroups(vehicleRowNos, params.batchSize),
  ];

  return units.sort((a, b) => a.context_from_row - b.context_from_row);
}

function unitsFromSpanTracker(
  tracker: SpanTracker,
  batchSize: number,
): ImportDryRunReconcileUnit[] {
  const units: ImportDryRunReconcileUnit[] = [];
  for (const span of tracker.values()) {
    if (span.count > 1 && spansImportBatches(span, batchSize)) {
      units.push(unitFromDuplicateSpan(span));
    }
  }
  return units;
}

function unitsFromVehicleGroups(
  vehicleRowNos: Map<string, number[]>,
  batchSize: number,
): ImportDryRunReconcileUnit[] {
  const units: ImportDryRunReconcileUnit[] = [];
  for (const rowNos of vehicleRowNos.values()) {
    if (rowNos.length < 2) {
      continue;
    }
    const min = Math.min(...rowNos);
    const max = Math.max(...rowNos);
    if (!spansImportBatches({ min_row: min, max_row: max }, batchSize)) {
      continue;
    }
    units.push({
      context_from_row: min,
      context_to_row: max,
      replan_row_nos: [...rowNos].sort((a, b) => a - b),
    });
  }
  return units;
}
