import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import type {
  ImportDryRunReconcileUnit,
  ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { replanImportDryRunUnit } from './import-dry-run-reconcile.plan-unit.js';
import {
  importWorkerChunkBudgetAllowsAnotherUnit,
  importWorkerChunkBudgetElapsed,
} from './import-reconcile-chunk-budget.js';
import {
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';

export type ReconcileChunkPersistResult = {
  job: { worker_claim_seq: number; worker_recovery_seq: number };
  totals: ImportJobTotals;
};

export type ReconcileChunkUnitLoopOutcome =
  | { kind: 'no_progress' }
  | { kind: 'lease_skip' }
  | {
      kind: 'lease_extend_failed';
      unitIndex: number;
      lastPersisted: ReconcileChunkPersistResult;
    }
  | { kind: 'finalized'; totals: ImportJobTotals }
  | {
      kind: 'partial';
      unitIndex: number;
      lastPersisted: ReconcileChunkPersistResult;
    };

export function reconcileChunkBudgetBlocksNextUnit(params: {
  readNow: () => number;
  chunkDeadlineMs: number;
  unitIndex: number;
  startUnitIndex: number;
}): boolean {
  if (
    importWorkerChunkBudgetElapsed(params.readNow(), params.chunkDeadlineMs)
  ) {
    return true;
  }
  return (
    params.unitIndex > params.startUnitIndex &&
    !importWorkerChunkBudgetAllowsAnotherUnit(
      params.readNow(),
      params.chunkDeadlineMs,
    )
  );
}

export async function replanAndPersistReconcileUnit(params: {
  jobStore: ImportJobStore;
  prisma: PrismaService;
  fileStorage: ImportFileStorageService;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  options: ImportJobOptionsWithWorker;
  leaseToken: string;
  job: {
    source_system: string;
    file_sha256: string;
    mapping_json: Record<string, string>;
    totals: ImportJobTotals;
  };
  unit: ImportDryRunReconcileUnit;
  unitIndex: number;
  unitsLength: number;
  upload: { object_key: string };
}) {
  const unitRows = await replanImportDryRunUnit({
    prisma: params.prisma,
    fileStorage: params.fileStorage,
    upload: params.upload,
    fileSha256: params.job.file_sha256,
    tenantId: params.tenantId,
    jobId: params.jobId,
    handler: params.handler,
    input: {
      tenantId: params.tenantId,
      sourceSystem: params.job.source_system,
      mapping: params.job.mapping_json,
      options: params.options,
    },
    unit: params.unit,
  });
  const nextUnitIndex = params.unitIndex + 1;
  const shouldFinalize = nextUnitIndex >= params.unitsLength;
  const persisted = await params.jobStore.persistDryRunReconcileChunk(
    params.tenantId,
    params.jobId,
    unitRows,
    { dry_run_reconcile_cursor: nextUnitIndex },
    params.options,
    params.leaseToken,
    shouldFinalize
      ? {
          expectedRows: params.job.totals.rows,
          optionsForPersist: stripWorker(params.options),
        }
      : undefined,
  );
  return { persisted, nextUnitIndex, shouldFinalize };
}

function stripWorker(options: ImportJobOptionsWithWorker): ImportJobOptions {
  const copy = { ...options };
  delete (copy as { worker?: unknown }).worker;
  return copy;
}

export async function runReconcileUnitsWithinChunkBudget(params: {
  jobStore: ImportJobStore;
  prisma: PrismaService;
  fileStorage: ImportFileStorageService;
  flow: ImportWorkerFlowDeps;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  options: ImportJobOptionsWithWorker;
  leaseToken: string;
  job: {
    source_system: string;
    file_sha256: string;
    mapping_json: Record<string, string>;
    totals: ImportJobTotals;
  };
  units: ImportDryRunReconcileUnit[];
  unitIndex: number;
  startUnitIndex: number;
  readNow: () => number;
  chunkDeadlineMs: number;
  upload: { object_key: string };
  completeDryRun: (totals: ImportJobTotals) => Promise<void>;
}): Promise<ReconcileChunkUnitLoopOutcome> {
  let unitIndex = params.unitIndex;
  let lastPersisted: ReconcileChunkPersistResult | null = null;

  while (unitIndex < params.units.length) {
    if (
      reconcileChunkBudgetBlocksNextUnit({
        readNow: params.readNow,
        chunkDeadlineMs: params.chunkDeadlineMs,
        unitIndex,
        startUnitIndex: params.startUnitIndex,
      })
    ) {
      break;
    }

    const unitResult = await replanAndPersistReconcileUnit({
      jobStore: params.jobStore,
      prisma: params.prisma,
      fileStorage: params.fileStorage,
      tenantId: params.tenantId,
      jobId: params.jobId,
      handler: params.handler,
      options: params.options,
      leaseToken: params.leaseToken,
      job: params.job,
      unit: params.units[unitIndex],
      unitIndex,
      unitsLength: params.units.length,
      upload: params.upload,
    });

    lastPersisted = unitResult.persisted;
    if (!lastPersisted) {
      await requeueImportWorkerAfterLeaseSkip(params.flow, {
        tenantId: params.tenantId,
        jobId: params.jobId,
        phase: 'dry_run',
      });
      return { kind: 'lease_skip' };
    }

    unitIndex = unitResult.nextUnitIndex;

    if (unitResult.shouldFinalize) {
      await params.completeDryRun(lastPersisted.totals);
      return { kind: 'finalized', totals: lastPersisted.totals };
    }

    const extended = await params.jobStore.extendWorkerLease(
      params.tenantId,
      params.jobId,
      params.leaseToken,
    );
    if (!extended) {
      return {
        kind: 'lease_extend_failed',
        unitIndex,
        lastPersisted,
      };
    }
  }

  if (unitIndex === params.startUnitIndex || !lastPersisted) {
    return { kind: 'no_progress' };
  }

  return { kind: 'partial', unitIndex, lastPersisted };
}
