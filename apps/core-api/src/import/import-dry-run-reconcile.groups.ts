import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportDryRunReconcileRange } from './import-job.worker-state.js';

type RowSpan = { min_row: number; max_row: number };

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
  spans: RowSpan[],
  batchSize: number,
): ImportDryRunReconcileRange[] {
  return spans
    .filter((span) => spansImportBatches(span, batchSize))
    .map((span) => ({ from_row: span.min_row, to_row: span.max_row }));
}

async function duplicateExternalIdSpans(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
): Promise<RowSpan[]> {
  return prisma.$queryRaw<RowSpan[]>`
    SELECT MIN(row_no)::int AS min_row, MAX(row_no)::int AS max_row
    FROM import_job_rows
    WHERE tenant_id = ${tenantId}::uuid
      AND import_job_id = ${jobId}::uuid
      AND external_id IS NOT NULL
    GROUP BY external_id
    HAVING COUNT(*) > 1
  `;
}

async function duplicateJsonFieldSpans(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  jsonField: string,
): Promise<RowSpan[]> {
  return prisma.$queryRaw<RowSpan[]>`
    SELECT MIN(row_no)::int AS min_row, MAX(row_no)::int AS max_row
    FROM import_job_rows
    WHERE tenant_id = ${tenantId}::uuid
      AND import_job_id = ${jobId}::uuid
      AND normalized_json IS NOT NULL
      AND normalized_json->>${jsonField} IS NOT NULL
      AND TRIM(normalized_json->>${jsonField}) <> ''
    GROUP BY LOWER(TRIM(normalized_json->>${jsonField}))
    HAVING COUNT(*) > 1
  `;
}

async function duplicateVehicleIdSpans(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
): Promise<RowSpan[]> {
  return prisma.$queryRaw<RowSpan[]>`
    SELECT MIN(row_no)::int AS min_row, MAX(row_no)::int AS max_row
    FROM import_job_rows
    WHERE tenant_id = ${tenantId}::uuid
      AND import_job_id = ${jobId}::uuid
      AND normalized_json IS NOT NULL
      AND normalized_json->>'vehicle_id' IS NOT NULL
    GROUP BY normalized_json->>'vehicle_id'
    HAVING COUNT(*) >= 2
  `;
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
  const { tenantId, jobId, entityType, batchSize } = params;
  const spans: RowSpan[] = [
    ...(await duplicateExternalIdSpans(prisma, tenantId, jobId)),
  ];

  if (entityType === ImportEntityType.CUSTOMER) {
    spans.push(
      ...(await duplicateJsonFieldSpans(prisma, tenantId, jobId, 'email')),
    );
  } else if (entityType === ImportEntityType.VEHICLE) {
    spans.push(
      ...(await duplicateJsonFieldSpans(prisma, tenantId, jobId, 'vin')),
    );
  } else if (entityType === ImportEntityType.LABOR_OPERATION) {
    spans.push(
      ...(await duplicateJsonFieldSpans(prisma, tenantId, jobId, 'code')),
    );
  } else if (
    entityType === ImportEntityType.VEHICLE_PARTY ||
    entityType === ImportEntityType.VEHICLE_DUE_DATE
  ) {
    spans.push(
      ...(await duplicateVehicleIdSpans(prisma, tenantId, jobId)),
    );
  }

  return mergeRowRanges(toRanges(spans, batchSize));
}
