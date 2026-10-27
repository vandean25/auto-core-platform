import type { ImportEntityType } from '@prisma/client';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { readImportWorkerBatchSize } from './import-limits.js';
import { reconcileChunkShouldStopBeforeNextUnit } from './import-reconcile-chunk-budget.js';
import { computeImportDryRunReconcileUnits } from './import-dry-run-reconcile.units.js';
import { replanImportDryRunUnit } from './import-dry-run-reconcile.plan-unit.js';
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

  let unitIndex = worker.dry_run_reconcile_cursor ?? 0;
  if (unitIndex >= units.length) {
    return;
  }

  const readNow = () => params.nowMs?.() ?? Date.now();
  const chunkStartedMs = readNow();
  const mapping = params.job.mapping_json as Record<string, string>;
  const rows: import('./import.types.js').DryRunRowResult[] = [];

  while (unitIndex < units.length) {
    if (reconcileChunkShouldStopBeforeNextUnit(readNow(), chunkStartedMs)) {
      break;
    }
    rows.push(
      ...(await replanImportDryRunUnit({
        prisma: params.prisma,
        fileStorage: params.fileStorage,
        upload,
        fileSha256: params.job.file_sha256,
        tenantId: params.tenantId,
        jobId: params.jobId,
        handler: params.handler,
        input: {
          tenantId: params.tenantId,
          sourceSystem: params.job.source_system,
          mapping,
          options: params.options,
        },
        unit: units[unitIndex],
      })),
    );
    unitIndex += 1;
  }

  const startIndex = worker.dry_run_reconcile_cursor ?? 0;
  if (unitIndex === startIndex) {
    return;
  }

  const nextUnitIndex = unitIndex;
  const shouldFinalize = nextUnitIndex >= units.length;

  const persisted = await params.jobStore.persistDryRunReconcileChunk(
    params.tenantId,
    params.jobId,
    rows,
    { dry_run_reconcile_cursor: nextUnitIndex },
    params.options,
    leaseToken,
    shouldFinalize
      ? {
          expectedRows: totals.rows,
          optionsForPersist: stripWorker(params.options),
        }
      : undefined,
  );
  if (!persisted) {
    await requeueImportWorkerAfterLeaseSkip(params.flow, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'dry_run',
    });
    return;
  }

  if (shouldFinalize) {
    await params.completeDryRun(persisted.totals);
    return;
  }

  await enqueueImportWorkerContinuation(params.flow, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: 'dry_run',
    claimSeq: persisted.job.worker_claim_seq,
    recoverySeq: persisted.job.worker_recovery_seq,
    chunkSeq: nextUnitIndex,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(
      persisted.job.worker_claim_seq,
    ),
  });
}

function stripWorker(options: ImportJobOptionsWithWorker): ImportJobOptions {
  const copy = { ...options };
  delete (copy as { worker?: unknown }).worker;
  return copy;
}
