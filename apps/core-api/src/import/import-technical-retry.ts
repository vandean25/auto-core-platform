import { ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isTechnicalImportRowErrorCode } from './import-apply.errors.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { ImportApplyRow } from './import-type-handler.js';

type ErrorRow = {
  row_no: number;
  entity_id: string | null;
  errors_json: Prisma.JsonValue | null;
};

export type TechnicalRetryPlan = {
  count: number;
  codes: string[];
  rowNos: number[];
};

function firstErrorCode(errorsJson: Prisma.JsonValue | null): string | null {
  if (!Array.isArray(errorsJson) || errorsJson.length === 0) {
    return null;
  }
  const first = errorsJson[0];
  if (!first || typeof first !== 'object' || !('code' in first)) {
    return null;
  }
  const code = (first as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function planTechnicalRetry(rows: ErrorRow[]): TechnicalRetryPlan {
  const codes = new Set<string>();
  const rowNos: number[] = [];
  for (const row of rows) {
    const code = firstErrorCode(row.errors_json);
    if (!code || !isTechnicalImportRowErrorCode(code)) {
      continue;
    }
    codes.add(code);
    rowNos.push(row.row_no);
  }
  return {
    count: rowNos.length,
    codes: [...codes].sort(),
    rowNos,
  };
}

function restoredAction(entityId: string | null): ImportRowAction {
  return entityId ? ImportRowAction.UPDATE : ImportRowAction.CREATE;
}

/** Puts technical ERROR rows back to CREATE/UPDATE so apply writes them again. */
export async function resetTechnicalImportErrorRows(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  plan: TechnicalRetryPlan,
  rows: ErrorRow[],
): Promise<void> {
  const pending = new Set(plan.rowNos);
  const byAction = new Map<ImportRowAction, number[]>();
  for (const row of rows) {
    if (!pending.has(row.row_no)) {
      continue;
    }
    const action = restoredAction(row.entity_id);
    const rowNos = byAction.get(action) ?? [];
    rowNos.push(row.row_no);
    byAction.set(action, rowNos);
  }
  for (const [action, rowNos] of byAction) {
    await prisma.importJobRow.updateMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { in: rowNos },
      },
      data: { action, errors_json: Prisma.JsonNull },
    });
  }
}

export function withoutTechnicalRetryRow(
  worker: ImportJobWorkerState,
  rowNo: number | undefined,
): ImportJobWorkerState {
  if (rowNo === undefined || !worker.technical_retry_row_nos?.length) {
    return worker;
  }
  const technical_retry_row_nos = worker.technical_retry_row_nos.filter(
    (pending) => pending !== rowNo,
  );
  if (
    technical_retry_row_nos.length === worker.technical_retry_row_nos.length
  ) {
    return worker;
  }
  if (technical_retry_row_nos.length === 0) {
    const next = { ...worker };
    delete next.technical_retry_row_nos;
    return next;
  }
  return { ...worker, technical_retry_row_nos };
}

/** Retry rows first, then the cursor tail, without listing a row twice. */
export function mergeTechnicalRetryBatch(
  retryRows: ImportApplyRow[],
  afterCursor: ImportApplyRow[],
  batchSize: number,
): { rows: ImportApplyRow[]; hasMore: boolean } {
  const seen = new Set<number>();
  const merged: ImportApplyRow[] = [];
  for (const row of [...retryRows, ...afterCursor]) {
    if (seen.has(row.row_no)) {
      continue;
    }
    seen.add(row.row_no);
    merged.push(row);
  }
  return {
    rows: merged.slice(0, batchSize),
    hasMore: merged.length > batchSize,
  };
}
