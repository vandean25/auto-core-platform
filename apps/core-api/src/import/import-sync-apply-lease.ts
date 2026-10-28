import { ImportJobStatus } from '@prisma/client';
import { IMPORT_APPLY_UNIT_BUDGET_MS } from './import-apply-lease.js';
import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyRow,
} from './import-type-handler.js';
import type { SerializedImportJob } from './import-job.serializer.js';

const MAX_SYNC_APPLY_UNITS = 10_000;

export type SyncApplyLeaseJob = {
  id: string;
  status: ImportJobStatus;
  options_json: unknown;
};

export async function runSyncApplyUnits<T extends SyncApplyLeaseJob>(params: {
  rows: ImportApplyRow[];
  initialLeaseToken: string | null;
  findJob: () => Promise<T | null>;
  extendLease: (leaseToken: string) => Promise<boolean>;
  applyRows: (
    rows: ImportApplyRow[],
    batchOptions: ImportApplyBatchOptions | undefined,
  ) => Promise<SerializedImportJob>;
}): Promise<SerializedImportJob> {
  if (!params.initialLeaseToken) {
    return params.applyRows(params.rows, undefined);
  }
  let leaseToken = params.initialLeaseToken;
  let cursor = await readCursor(params.findJob);
  for (let unit = 0; unit < MAX_SYNC_APPLY_UNITS; unit++) {
    const pending = await rowsPendingForSyncUnit(
      params.findJob,
      params.rows,
      cursor,
    );
    if (pending.rows.length === 0) {
      return params.applyRows([], {
        leaseToken,
        resumeAfterApplySeq: cursor,
        chunkDeadlineMs: Date.now() + IMPORT_APPLY_UNIT_BUDGET_MS,
      });
    }
    const applied = await params.applyRows(pending.rows, {
      leaseToken,
      resumeAfterApplySeq: 0,
      chunkDeadlineMs: Date.now() + IMPORT_APPLY_UNIT_BUDGET_MS,
    });
    if (applied.status !== ImportJobStatus.APPLYING) {
      return applied;
    }
    const extended = await params.extendLease(leaseToken);
    const job = await params.findJob();
    const worker = readWorkerState(
      job?.options_json as ImportJobOptionsWithWorker,
    );
    if (!job || !worker || !extended) {
      return applied;
    }
    leaseToken = worker.lease_token;
    const nextCursor = worker.last_committed_apply_seq ?? cursor;
    const retryLeft = worker.technical_retry_row_nos?.length ?? 0;
    if (nextCursor === cursor && retryLeft === pending.retryCount) {
      return applied;
    }
    cursor = nextCursor;
  }
  return params.applyRows(params.rows, {
    leaseToken,
    resumeAfterApplySeq: cursor,
  });
}

async function rowsPendingForSyncUnit(
  findJob: () => Promise<SyncApplyLeaseJob | null>,
  rows: ImportApplyRow[],
  cursor: number,
): Promise<{ rows: ImportApplyRow[]; retryCount: number }> {
  const job = await findJob();
  const worker = readWorkerState(
    job?.options_json as ImportJobOptionsWithWorker,
  );
  const retryNos = new Set(worker?.technical_retry_row_nos ?? []);
  const retryRows = rows.filter((row) => retryNos.has(row.row_no));
  const afterCursor = rows.filter(
    (row) =>
      !retryNos.has(row.row_no) && (row.apply_seq ?? row.row_no) > cursor,
  );
  return {
    rows: [...retryRows, ...afterCursor],
    retryCount: retryNos.size,
  };
}

async function readCursor(
  findJob: () => Promise<SyncApplyLeaseJob | null>,
): Promise<number> {
  const job = await findJob();
  const worker = readWorkerState(
    job?.options_json as ImportJobOptionsWithWorker,
  );
  return worker?.last_committed_apply_seq ?? 0;
}
