import { ImportRowAction } from '@prisma/client';
import type { DryRunRowResult, ImportJobTotals } from './import.types.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import {
  enqueueImportWorkerContinuation,
  importWorkerTaskClaimSeqForHandoff,
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';

export function mergeDryRunBatchTotals(
  totals: ImportJobTotals,
  rows: DryRunRowResult[],
  processed: number,
): ImportJobTotals {
  const mergedTotals = { ...totals };
  for (const row of rows) {
    if (row.action === ImportRowAction.CREATE) mergedTotals.create += 1;
    else if (row.action === ImportRowAction.UPDATE) mergedTotals.update += 1;
    else if (row.action === ImportRowAction.SKIP) mergedTotals.skip += 1;
    else if (row.action === ImportRowAction.ERROR) mergedTotals.error += 1;
  }
  mergedTotals.rows = Math.max(totals.rows, processed);
  return mergedTotals;
}

export async function persistDryRunBatchAndHandoff(params: {
  jobStore: ImportJobStore;
  flow: ImportWorkerFlowDeps;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  options: ImportJobOptionsWithWorker;
  rows: DryRunRowResult[];
  mergedTotals: ImportJobTotals;
  processed: number;
  totalRows: number;
  completeDryRun: () => Promise<void>;
}): Promise<void> {
  const leaseToken = params.options.worker?.lease_token;
  if (!leaseToken) {
    return;
  }
  const appended = await params.jobStore.appendDryRunRows(
    params.tenantId,
    params.jobId,
    params.rows,
    params.mergedTotals,
    { processed_rows: params.processed },
    params.options,
    leaseToken,
  );
  if (!appended) {
    await requeueImportWorkerAfterLeaseSkip(params.flow, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'dry_run',
    });
    return;
  }
  if (params.processed >= params.totalRows) {
    await params.completeDryRun();
    return;
  }
  const refreshed = appended;
  await enqueueImportWorkerContinuation(params.flow, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: 'dry_run',
    claimSeq: refreshed.worker_claim_seq,
    recoverySeq: refreshed.worker_recovery_seq,
    chunkSeq: params.processed,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(
      refreshed.worker_claim_seq,
    ),
  });
}
