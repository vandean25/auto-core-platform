import { randomUUID } from 'node:crypto';
import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isTechnicalImportRowErrorCode } from './import-apply.errors.js';
import { nextApplyLeaseUntil } from './import-apply-lease.js';
import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportJobWorkerState,
} from './import-job.worker-state.js';
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

type RetryDb = Pick<PrismaService, 'importJobRow'>;

/** Clears technical ERROR rows after the retry list is already stored. */
export async function resetTechnicalImportErrorRows(
  db: RetryDb,
  tenantId: string,
  jobId: string,
  rowNos: number[],
): Promise<void> {
  if (rowNos.length === 0) {
    return;
  }
  const wanted = new Set(rowNos);
  const loaded = await db.importJobRow.findMany({
    where: {
      tenant_id: tenantId,
      import_job_id: jobId,
      row_no: { in: rowNos },
      action: ImportRowAction.ERROR,
    },
  });
  const rows = loaded.filter(
    (row) => wanted.has(row.row_no) && row.action === ImportRowAction.ERROR,
  );
  const byAction = new Map<ImportRowAction, number[]>();
  for (const row of rows) {
    const action = restoredAction(row.entity_id);
    const group = byAction.get(action) ?? [];
    group.push(row.row_no);
    byAction.set(action, group);
  }
  for (const [action, grouped] of byAction) {
    await db.importJobRow.updateMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { in: grouped },
      },
      data: { action, errors_json: Prisma.JsonNull },
    });
  }
}

export function applyLockForReapply(
  options: ImportJobOptionsWithWorker,
  extraStatuses: ImportJobStatus[],
  nowMs: number,
): { options: ImportJobOptionsWithWorker; statuses: ImportJobStatus[] } {
  const previous = readWorkerState(options);
  const retryRowNos = technicalRetryRowNos(options, previous);
  const optionsWithoutRetry = { ...options };
  delete optionsWithoutRetry.technical_retry_row_nos;
  const worker: ImportJobWorkerState = {
    phase: 'apply',
    lease_token: randomUUID(),
    lease_until: nextApplyLeaseUntil(nowMs),
    processed_rows: previous?.processed_rows ?? 0,
    last_committed_apply_seq: previous?.last_committed_apply_seq ?? 0,
    started_at: previous?.started_at ?? new Date(nowMs).toISOString(),
  };
  if (retryRowNos.length > 0) {
    worker.technical_retry_row_nos = retryRowNos;
  }
  return {
    options: { ...optionsWithoutRetry, worker },
    statuses: [
      ImportJobStatus.DRY_RUN_DONE,
      ImportJobStatus.FAILED,
      ...extraStatuses,
    ],
  };
}

export function technicalRetryRowNos(
  options: ImportJobOptionsWithWorker,
  previous: ImportJobWorkerState | null,
): number[] {
  return (
    options.technical_retry_row_nos ?? previous?.technical_retry_row_nos ?? []
  );
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
export function mergeTechnicalRetryRowNos(
  existing: number[],
  planned: number[],
): number[] {
  return [...new Set([...existing, ...planned])].sort((a, b) => a - b);
}

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
