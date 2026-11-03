import { ImportJobStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { IMPORT_RECONCILE_UNIT_TX } from './import.constants.js';
import {
  dryRunRowCreateInput,
  persistGroupedDryRunRowUpdates,
} from './import-dry-run-reconcile.persist-rows.js';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import {
  delayMs,
  retryableTransactionDelayMs,
} from './import-transaction-retry.util.js';
import {
  importWorkerPoisonProgressCursor,
  importWorkerProgressCursor,
  type ImportJobOptionsWithWorker,
  type ImportJobWorkerState,
} from './import-job.worker-state.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';
import {
  applyingWorkerLeaseWhere,
  failImportJobForRetryExhausted,
  isPrismaTransactionExpired,
  lockWorkerLeaseOnApplyingJob,
  runInCapturedTenantContext,
} from './import-job.store.worker-lease.js';

/** Persistence of background dry-run rows, reconcile chunks and their job updates. */

export function toRowCreate(row: DryRunRowResult) {
  return dryRunRowCreateInput(row);
}

export async function appendDryRunRows(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  rows: DryRunRowResult[],
  totals: ImportJobTotals,
  workerPatch: Partial<ImportJobWorkerState>,
  options: ImportJobOptionsWithWorker,
  leaseToken: string,
) {
  const previousProcessed = importWorkerProgressCursor(options.worker!);
  const worker = {
    ...options.worker!,
    ...workerPatch,
    lease_until: new Date(0).toISOString(),
  };
  const progressed = importWorkerProgressCursor(worker) > previousProcessed;
  return prisma.$transaction(async (tx) => {
    if (
      !(await lockWorkerLeaseOnApplyingJob(tx, tenantId, jobId, leaseToken))
    ) {
      return null;
    }
    return tx.importJob.update({
      where: { tenant_id: tenantId, id: jobId },
      data: {
        totals_json: totals,
        options_json: { ...options, worker },
        worker_handoff_at: new Date(),
        ...(progressed ? { attempts_without_progress: 0 } : {}),
        rows: { create: rows.map(toRowCreate) },
      },
    });
  });
}

export async function beginBackgroundDryRunReconcile(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  units: ImportJobWorkerState['dry_run_reconcile_units'],
  options: ImportJobOptionsWithWorker,
  leaseToken: string,
) {
  const worker: ImportJobWorkerState = {
    ...options.worker!,
    dry_run_reconcile_active: true,
    dry_run_reconcile_cursor: 0,
    dry_run_reconcile_units: units,
    claimed_processed_rows: 0,
    lease_until: new Date(0).toISOString(),
  };
  const updated = await prisma.importJob.updateMany({
    where: applyingWorkerLeaseWhere(tenantId, jobId, leaseToken),
    data: {
      options_json: { ...options, worker },
      worker_handoff_at: new Date(),
    },
  });
  return updated.count > 0;
}

export async function finalizeBackgroundDryRunReconcile(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  leaseToken: string,
  expectedRows: number,
  options: ImportJobOptionsWithWorker,
): Promise<{ totals: ImportJobTotals } | null> {
  const { tallyImportDryRunTotalsFromRows } =
    await import('./import-dry-run-reconcile.totals.js');
  return prisma.$transaction(async (tx) => {
    if (
      !(await lockWorkerLeaseOnApplyingJob(tx, tenantId, jobId, leaseToken))
    ) {
      return null;
    }
    const totals = await tallyImportDryRunTotalsFromRows(
      tx,
      tenantId,
      jobId,
      expectedRows,
    );
    const optionsForPersist = { ...options };
    delete (optionsForPersist as { worker?: unknown }).worker;
    const finished = await tx.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.DRY_RUN_DONE,
        totals_json: totals,
        options_json: optionsForPersist,
      },
    });
    if (finished.count === 0) {
      return null;
    }
    return { totals };
  });
}

export async function persistDryRunReconcileChunk(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  rows: DryRunRowResult[],
  workerPatch: Partial<ImportJobWorkerState>,
  options: ImportJobOptionsWithWorker,
  leaseToken: string,
  finalize?: {
    expectedRows: number;
    optionsForPersist: ImportJobOptions;
  },
) {
  const tenantUserForTransactions = TenantContextStorage.getUser();
  const previousProgress = importWorkerPoisonProgressCursor(options.worker!);
  const worker = {
    ...options.worker!,
    ...workerPatch,
    lease_until: new Date(0).toISOString(),
  };
  const progressed =
    importWorkerPoisonProgressCursor(worker) > previousProgress;
  const { tallyImportDryRunTotalsFromRows } =
    await import('./import-dry-run-reconcile.totals.js');

  const runUnitTransaction = () =>
    prisma.$transaction(
      async (tx) =>
        runInCapturedTenantContext(async () => {
          if (
            !(await lockWorkerLeaseOnApplyingJob(
              tx,
              tenantId,
              jobId,
              leaseToken,
            ))
          ) {
            return null;
          }
          await persistGroupedDryRunRowUpdates(tx, tenantId, jobId, rows);
          if (finalize) {
            const totals = await tallyImportDryRunTotalsFromRows(
              tx,
              tenantId,
              jobId,
              finalize.expectedRows,
            );
            const finished = await tx.importJob.update({
              where: { tenant_id: tenantId, id: jobId },
              data: {
                status: ImportJobStatus.DRY_RUN_DONE,
                totals_json: totals,
                options_json: finalize.optionsForPersist,
                worker_handoff_at: new Date(),
                ...(progressed ? { attempts_without_progress: 0 } : {}),
              },
            });
            return { job: finished, totals };
          }
          const updated = await tx.importJob.update({
            where: { tenant_id: tenantId, id: jobId },
            data: {
              options_json: { ...options, worker },
              worker_handoff_at: new Date(),
              ...(progressed ? { attempts_without_progress: 0 } : {}),
            },
          });
          const totals = updated.totals_json as ImportJobTotals;
          return { job: updated, totals };
        }, tenantUserForTransactions),
      IMPORT_RECONCILE_UNIT_TX,
    );

  let lastTransactionExpired: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await runUnitTransaction();
    } catch (error) {
      if (!isPrismaTransactionExpired(error)) {
        throw error;
      }
      lastTransactionExpired = error;
      if (attempt === 0) {
        await delayMs(retryableTransactionDelayMs(0));
      }
    }
  }

  const failed = await prisma.$transaction(async (tx) =>
    runInCapturedTenantContext(
      async () =>
        failImportJobForRetryExhausted(tx, tenantId, jobId, leaseToken),
      tenantUserForTransactions,
    ),
  );
  if (failed) {
    throw new ImportApplyRetryExhaustedError(lastTransactionExpired);
  }
  return null;
}
