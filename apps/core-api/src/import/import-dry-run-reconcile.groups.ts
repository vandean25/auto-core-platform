import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportDryRunReconcileRange } from './import-job.worker-state.js';

type RowSpan = { min_row: number; max_row: number };

type SpanTracker = Map<string, RowSpan & { count: number }>;

function spansImportBatches(span: RowSpan, batchSize: number): boolean {
  const firstBatch = Math.floor((span.min_row - 1) / batchSize);
  const lastBatch = Math.floor((span.max_row - 1) / batchSize);
  return firstBatch !== lastBatch;
}

function mergeRowRanges(
  ranges: ImportDryRunReconcileRange[],
): ImportDryRunReconcileRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.from_row - b.from_row);
  const merged: ImportDryRunReconcileRange[] = [{ ...sorted[0] }];
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.from_row <= last.to_row + 1) {
      last.to_row = Math.max(last.to_row, current.to_row);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function toRanges(
  spans: Iterable<RowSpan & { count: number }>,
  batchSize: number,
): ImportDryRunReconcileRange[] {
  return [...spans]
    .filter((span) => span.count > 1 && spansImportBatches(span, batchSize))
    .map((span) => ({ from_row: span.min_row, to_row: span.max_row }));
}

function trackKey(tracker: SpanTracker, key: string, rowNo: number): void {
  const existing = tracker.get(key);
  if (!existing) {
    tracker.set(key, { min_row: rowNo, max_row: rowNo, count: 1 });
    return;
  }
  existing.min_row = Math.min(existing.min_row, rowNo);
  existing.max_row = Math.max(existing.max_row, rowNo);
  existing.count += 1;
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

/** Ranges that must be re-planned so cross-batch duplicate and overlap checks match sync dry-run. */
export async function computeImportDryRunReconcileRanges(
  prisma: PrismaService,
  params: {
    tenantId: string;
    jobId: string;
    entityType: ImportEntityType;
    batchSize: number;
  },
): Promise<ImportDryRunReconcileRange[]> {
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
  const vehicleSpans: SpanTracker = new Map();

  for (const row of rows) {
    if (row.external_id) {
      trackKey(externalIdSpans, row.external_id, row.row_no);
    }
    if (params.entityType === ImportEntityType.CUSTOMER) {
      trackNormalizedField(
        secondarySpans,
        row.normalized_json,
        'email',
        row.row_no,
        true,
      );
    } else if (params.entityType === ImportEntityType.VEHICLE) {
      trackNormalizedField(
        secondarySpans,
        row.normalized_json,
        'vin',
        row.row_no,
        true,
      );
    } else if (params.entityType === ImportEntityType.LABOR_OPERATION) {
      trackNormalizedField(
        secondarySpans,
        row.normalized_json,
        'code',
        row.row_no,
        true,
      );
    }
    if (
      params.entityType === ImportEntityType.VEHICLE_PARTY ||
      params.entityType === ImportEntityType.VEHICLE_DUE_DATE
    ) {
      const vehicleId = normalizedString(row.normalized_json, 'vehicle_id');
      if (vehicleId) {
        trackKey(vehicleSpans, vehicleId, row.row_no);
      }
    }
  }

  const spans = [
    ...toRanges(externalIdSpans.values(), params.batchSize),
    ...toRanges(secondarySpans.values(), params.batchSize),
    ...toRanges(
      [...vehicleSpans.values()].filter((span) => span.count >= 2),
      params.batchSize,
    ),
  ];

  return mergeRowRanges(spans);
}
