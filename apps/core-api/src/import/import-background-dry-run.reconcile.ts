import type { ImportEntityType } from '@prisma/client';
import type { ImportJobTotals } from './import.types.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { readImportWorkerBatchSize } from './import-limits.js';
import { importWorkerChunkDeadlineMs } from './import-reconcile-chunk-budget.js';
import { computeImportDryRunReconcileUnits } from './import-dry-run-reconcile.units.js';
import { runReconcileUnitsWithinChunkBudget } from './import-background-dry-run.reconcile-unit.js';
import {
  enqueueImportWorkerContinuation,
  importWorkerTaskClaimSeqForHandoff,
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';
import { readUploadRef } from './import-job.worker-state.js';
export async function finalizeBackgroundDryRunReconcileIfComplete(params: {
  jobStore: ImportJobStore;
  tenantId: string;
  jobId: string;
  options: ImportJobOptionsWithWorker;
  leaseToken: string;
  expectedRows: number;
  completeDryRun: (totals: ImportJobTotals) => Promise<void>;
}): Promise<boolean> {
  const worker = params.options.worker;
  const units = worker?.dry_run_reconcile_units ?? [];
  const unitIndex = worker?.dry_run_reconcile_cursor ?? 0;
  if (!worker?.dry_run_reconcile_active || unitIndex < units.length) {
    return false;
  }
  const finalized = await params.jobStore.finalizeBackgroundDryRunReconcile(
    params.tenantId,
    params.jobId,
    params.leaseToken,
    params.expectedRows,
    params.options,
  );
  if (!finalized) {
    return false;
  }
  await params.completeDryRun(finalized.totals);
  return true;
}

export async function scheduleBackgroundDryRunAfterRowBatches(params: {
  jobStore: ImportJobStore;
  prisma: PrismaService;
  tenantId: string;
  jobId: string;
  entityType: ImportEntityType;
  options: ImportJobOptionsWithWorker;
  totals: ImportJobTotals;
  completeDryRun: () => Promise<void>;
  flow: ImportWorkerFlowDeps;
}): Promise<void> {
  const leaseToken = params.options.worker?.lease_token;
  if (!leaseToken) {
    return;
  }
  const units = await computeImportDryRunReconcileUnits(params.prisma, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    entityType: params.entityType,
    batchSize: readImportWorkerBatchSize(),
  });
  if (units.length === 0) {
    await params.completeDryRun();
    return;
  }
  const began = await params.jobStore.beginBackgroundDryRunReconcile(
    params.tenantId,
    params.jobId,
    units,
    params.options,
    leaseToken,
  );
  if (!began) {
    await requeueImportWorkerAfterLeaseSkip(params.flow, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'dry_run',
    });
    return;
  }
  const refreshed = await params.jobStore.findJob(
    params.tenantId,
    params.jobId,
  );
  if (!refreshed) {
    return;
  }
  await enqueueImportWorkerContinuation(params.flow, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: 'dry_run',
    claimSeq: refreshed.worker_claim_seq,
    recoverySeq: refreshed.worker_recovery_seq,
    chunkSeq: 0,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(
      refreshed.worker_claim_seq,
    ),
  });
}

export async function runBackgroundDryRunReconcileChunk(params: {
  jobStore: ImportJobStore;
  prisma: PrismaService;
  fileStorage: ImportFileStorageService;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  options: ImportJobOptionsWithWorker;
  job: {
    source_system: string;
    file_sha256: string;
    mapping_json: unknown;
    totals_json: unknown;
  };
  flow: ImportWorkerFlowDeps;
  completeDryRun: (totals: ImportJobTotals) => Promise<void>;
  nowMs?: () => number;
}): Promise<void> {
  const worker = params.options.worker;
  const upload = readUploadRef(params.options);
  const leaseToken = worker?.lease_token;
  const units = worker?.dry_run_reconcile_units ?? [];
  if (!worker || !upload || !leaseToken || !worker.dry_run_reconcile_active) {
    return;
  }

  const totals = params.job.totals_json as ImportJobTotals;
  if (
    await finalizeBackgroundDryRunReconcileIfComplete({
      jobStore: params.jobStore,
      tenantId: params.tenantId,
      jobId: params.jobId,
      options: params.options,
      leaseToken,
      expectedRows: totals.rows,
      completeDryRun: params.completeDryRun,
    })
  ) {
    return;
  }

  const unitIndex = worker.dry_run_reconcile_cursor ?? 0;
  if (unitIndex >= units.length) {
    return;
  }

  const readNow = () => params.nowMs?.() ?? Date.now();
  const chunkDeadlineMs = importWorkerChunkDeadlineMs(readNow());
  const startUnitIndex = unitIndex;

  const mapping = params.job.mapping_json as Record<string, string>;
  const loopOutcome = await runReconcileUnitsWithinChunkBudget({
    jobStore: params.jobStore,
    prisma: params.prisma,
    fileStorage: params.fileStorage,
    flow: params.flow,
    tenantId: params.tenantId,
    jobId: params.jobId,
    handler: params.handler,
    options: params.options,
    leaseToken,
    job: {
      source_system: params.job.source_system,
      file_sha256: params.job.file_sha256,
      mapping_json: mapping,
      totals,
    },
    units,
    unitIndex,
    startUnitIndex,
    readNow,
    chunkDeadlineMs,
    upload,
    completeDryRun: params.completeDryRun,
  });

  if (loopOutcome.kind !== 'partial') {
    return;
  }

  await enqueueImportWorkerContinuation(params.flow, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: 'dry_run',
    claimSeq: loopOutcome.lastPersisted.job.worker_claim_seq,
    recoverySeq: loopOutcome.lastPersisted.job.worker_recovery_seq,
    chunkSeq: loopOutcome.unitIndex,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(
      loopOutcome.lastPersisted.job.worker_claim_seq,
    ),
  });
}
