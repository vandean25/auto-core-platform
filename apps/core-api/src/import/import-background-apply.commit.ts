import {
  ImportJobStatus,
  type ImportEntityType,
  type Prisma,
} from '@prisma/client';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobTotals } from './import.types.js';
import {
  isBackgroundApplyOutcomeComplete,
  reconcileFinishedApplyTotals,
} from './import-background-apply.totals.js';
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
): Promise<void> {
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
  if (options.worker?.lease_token !== leaseToken) {
    throw new ImportWorkerLeaseLostError();
  }
}

async function resolveBackgroundApplyFinishState(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    entityType: ImportEntityType;
    applySeq: number;
    maxApplySeq: number;
  },
  totals: ImportJobTotals,
): Promise<{ totals: ImportJobTotals; finished: boolean }> {
  const reachedLastSeq = params.applySeq >= params.maxApplySeq;
  if (!reachedLastSeq) {
    return { totals, finished: false };
  }
  const reconciled = await reconcileFinishedApplyTotals(
    tx,
    {
      tenantId: params.tenantId,
      jobId: params.jobId,
      entityType: params.entityType,
    },
    totals,
  );
  const complete = await isBackgroundApplyOutcomeComplete(
    tx,
    { tenantId: params.tenantId, jobId: params.jobId },
    reconciled,
  );
  return { totals: reconciled, finished: complete };
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
  },
): Promise<boolean> {
  await assertApplyWorkerLease(
    tx,
    params.tenantId,
    params.jobId,
    params.leaseToken,
  );
  const job = await tx.importJob.findFirst({
    where: { tenant_id: params.tenantId, id: params.jobId },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const worker = options.worker;
  if (!worker) {
    throw new ImportWorkerLeaseLostError();
  }
  const workerNext = {
    ...worker,
    last_committed_apply_seq: params.applySeq,
    processed_rows: params.applySeq,
  };
  const storedTotals = (job.totals_json ?? {}) as ImportJobTotals;
  const mergedTotals = mergeMonotonicApplyTotals(storedTotals, params.totals);
  const { totals, finished } = await resolveBackgroundApplyFinishState(
    tx,
    {
      tenantId: params.tenantId,
      jobId: params.jobId,
      entityType: job.entity_type,
      applySeq: params.applySeq,
      maxApplySeq: params.maxApplySeq,
    },
    mergedTotals,
  );
  await tx.importJob.update({
    where: { id: params.jobId },
    data: {
      totals_json: totals,
      options_json: { ...options, worker: workerNext },
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
