import { ImportJobStatus, type Prisma } from '@prisma/client';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobTotals } from './import.types.js';
import { advanceContiguousApplySeqWatermark } from './import-apply-sequence.js';
import { withoutTechnicalRetryRow } from './import-technical-retry.js';
import {
  readImportJobExpectedRowCount,
  tallyImportApplyTotalsFromRows,
} from './import-apply-persisted-totals.js';
import { isBackgroundApplyOutcomeComplete } from './import-background-apply.totals.js';
const APPLY_TOTAL_KEYS = [
  'rows',
  'create',
  'update',
  'skip',
  'error',
] as const satisfies ReadonlyArray<keyof ImportJobTotals>;

function mergeMonotonicApplyTotals(
  storedTotals: ImportJobTotals,
  nextTotals: ImportJobTotals,
): ImportJobTotals {
  const merged = { ...nextTotals };
  for (const key of APPLY_TOTAL_KEYS) {
    merged[key] = Math.max(storedTotals[key] ?? 0, nextTotals[key] ?? 0);
  }
  return merged;
}

export async function assertApplyWorkerLease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
) {
  const job = await tx.importJob.findFirst({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  if (options.worker && options.worker.lease_token !== leaseToken) {
    throw new ImportWorkerLeaseLostError();
  }
  return job;
}

async function resolveBackgroundApplyFinishState(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    applyWatermark: number;
    maxApplySeq: number;
  },
  totals: ImportJobTotals,
): Promise<{ totals: ImportJobTotals; finished: boolean }> {
  const reachedLastSeq = params.applyWatermark >= params.maxApplySeq;
  if (!reachedLastSeq) {
    return { totals, finished: false };
  }
  const complete = await isBackgroundApplyOutcomeComplete(
    tx,
    { tenantId: params.tenantId, jobId: params.jobId },
    totals,
  );
  return { totals, finished: complete };
}

function advanceWorkerThroughSpan(
  worker: NonNullable<ImportJobOptionsWithWorker['worker']>,
  applySeqs: number[],
  rowNos: number[],
) {
  let applyWatermark = worker.last_committed_apply_seq ?? 0;
  for (const seq of applySeqs) {
    applyWatermark = advanceContiguousApplySeqWatermark(applyWatermark, seq);
  }
  let workerNext: NonNullable<ImportJobOptionsWithWorker['worker']> = {
    ...worker,
    last_committed_apply_seq: applyWatermark,
    processed_rows: applyWatermark,
  };
  for (const rowNo of rowNos) {
    workerNext = withoutTechnicalRetryRow(workerNext, rowNo);
  }
  return { applyWatermark, workerNext };
}

/** Persists cursor, totals, and optionally APPLIED for one or more rows in the same transaction. */
export async function commitBackgroundApplySpanInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    leaseToken: string;
    applySeqs: number[];
    totals: ImportJobTotals;
    maxApplySeq: number;
    rowNos: number[];
  },
): Promise<boolean> {
  const job = await assertApplyWorkerLease(
    tx,
    params.tenantId,
    params.jobId,
    params.leaseToken,
  );
  const options = job.options_json as ImportJobOptionsWithWorker;
  const worker = options.worker;
  if (!worker) {
    throw new ImportWorkerLeaseLostError();
  }
  const { applyWatermark, workerNext } = advanceWorkerThroughSpan(
    worker,
    params.applySeqs,
    params.rowNos,
  );
  const storedTotals = (job.totals_json ?? {}) as ImportJobTotals;
  const mergedTotals = mergeMonotonicApplyTotals(storedTotals, params.totals);
  const retryStillPending =
    (workerNext.technical_retry_row_nos?.length ?? 0) > 0;
  const { totals, finished: sequenceFinished } =
    await resolveBackgroundApplyFinishState(
      tx,
      {
        tenantId: params.tenantId,
        jobId: params.jobId,
        applyWatermark,
        maxApplySeq: params.maxApplySeq,
      },
      mergedTotals,
    );
  const finished = sequenceFinished && !retryStillPending;
  const totalsForPersist = finished
    ? await (async () => {
        const { expectedRows, flaggedJumps } =
          await readImportJobExpectedRowCount(
            tx,
            params.tenantId,
            params.jobId,
          );
        const tallied = await tallyImportApplyTotalsFromRows(
          tx,
          params.tenantId,
          params.jobId,
          expectedRows,
          flaggedJumps,
        );
        return storedTotals.custom_field_counts
          ? {
              ...tallied,
              custom_field_counts: storedTotals.custom_field_counts,
            }
          : tallied;
      })()
    : totals;
  const retryProgressed =
    (worker.technical_retry_row_nos?.length ?? 0) >
    (workerNext.technical_retry_row_nos?.length ?? 0);
  const progressed =
    applyWatermark > (worker.last_committed_apply_seq ?? 0) || retryProgressed;
  await tx.importJob.update({
    where: { id: params.jobId },
    data: {
      totals_json: totalsForPersist,
      options_json: { ...options, worker: workerNext },
      ...(progressed ? { attempts_without_progress: 0 } : {}),
      ...(finished
        ? {
            status: ImportJobStatus.APPLIED,
            appliedAt: new Date(),
          }
        : {}),
    },
  });
  return finished;
}

/** Persists cursor, totals, and optionally APPLIED in the same transaction as the row write. */
export async function commitBackgroundApplyRowInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    leaseToken: string;
    applySeq: number;
    totals: ImportJobTotals;
    maxApplySeq: number;
    rowNo?: number;
  },
): Promise<boolean> {
  return commitBackgroundApplySpanInTransaction(tx, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    leaseToken: params.leaseToken,
    applySeqs: [params.applySeq],
    totals: params.totals,
    maxApplySeq: params.maxApplySeq,
    rowNos: params.rowNo !== undefined ? [params.rowNo] : [],
  });
}
