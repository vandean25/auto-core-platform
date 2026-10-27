import { randomUUID } from 'node:crypto';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';
import {
  IMPORT_RECONCILE_UNIT_TX,
  IMPORT_ROW_TX_MAX_ATTEMPTS,
  IMPORT_SERIALIZABLE_TX,
} from './import.constants.js';
import {
  dryRunRowCreateInput,
  persistGroupedDryRunRowUpdates,
} from './import-dry-run-reconcile.persist-rows.js';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import {
  delayMs,
  retryableTransactionDelayMs,
} from './import-transaction-retry.util.js';
import { advanceContiguousApplySeqWatermark } from './import-apply-sequence.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
  IMPORT_WORKER_LEASE_MS,
  importWorkerPoisonProgressCursor,
  importWorkerProgressCursor,
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportJobUploadRef,
  type ImportJobWorkerState,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';
import type { ImportApplyRow } from './import-type-handler.js';
import { assertApplyWorkerLease } from './import-background-apply.commit.js';
import { fillImportJobApplySequences } from './import-apply-sequence-fill.js';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';

export type CreateDryRunJobInput = {
  tenantId: string;
  entityType: ImportEntityType;
  sourceSystem: string;
  fileName?: string;
  fileSha256: string;
  mapping: Record<string, string>;
  options: ImportJobOptions;
  totals: ImportJobTotals;
  actorUserId: string;
  rows: DryRunRowResult[];
};

export function toImportApplyRow(
  row: Prisma.ImportJobRowGetPayload<object>,
): ImportApplyRow {
  return {
    row_no: row.row_no,
    apply_seq: row.apply_seq,
    action: row.action,
    entity_id: row.entity_id,
    external_id: row.external_id,
    normalized_json: row.normalized_json ?? {},
  };
}

function applyingWorkerLeaseWhere(
  tenantId: string,
  jobId: string,
  leaseToken: string,
) {
  return {
    tenant_id: tenantId,
    id: jobId,
    status: ImportJobStatus.APPLYING,
    options_json: {
      path: ['worker', 'lease_token'],
      equals: leaseToken,
    },
  };
}

async function lockWorkerLeaseOnApplyingJob(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const locked = await tx.importJob.updateMany({
    where: applyingWorkerLeaseWhere(tenantId, jobId, leaseToken),
    data: {},
  });
  return locked.count > 0;
}

function toRowCreate(row: DryRunRowResult) {
  return dryRunRowCreateInput(row);
}

function workerLeaseBlocksClaim(
  worker: ImportJobWorkerState,
  nowMs: number,
): boolean {
  const leaseUntil = Date.parse(worker.lease_until);
  return Number.isFinite(leaseUntil) && leaseUntil > nowMs;
}

function nextAttemptsWithoutProgress(
  worker: ImportJobWorkerState,
  cursorAtClaim: number,
  priorAttempts: number,
): number {
  const noProgressSinceLastClaim =
    worker.claimed_processed_rows !== undefined &&
    cursorAtClaim === worker.claimed_processed_rows;
  return noProgressSinceLastClaim ? priorAttempts + 1 : 0;
}

async function runInCapturedTenantContext<T>(
  fn: () => Promise<T>,
  tenantUser = TenantContextStorage.getUser(),
): Promise<T> {
  if (!tenantUser?.tenantId) {
    return fn();
  }
  return new Promise<T>((resolve, reject) => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setUser(tenantUser);
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

function isPrismaTransactionExpired(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2028'
  );
}

async function markImportJobFailedInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    where: Prisma.ImportJobWhereInput;
    applyFailureReason: 'poison_cap' | 'retry_exhausted';
    attemptsWithoutProgress?: number;
  },
): Promise<number> {
  const job = await tx.importJob.findFirst({
    where: { tenant_id: params.tenantId, id: params.jobId },
    select: { options_json: true },
  });
  const options = {
    ...((job?.options_json as Record<string, unknown> | null) ?? {}),
    apply_failure_reason: params.applyFailureReason,
  };
  const updated = await tx.importJob.updateMany({
    where: params.where,
    data: {
      status: ImportJobStatus.FAILED,
      failed_at: new Date(),
      options_json: options,
      ...(params.attemptsWithoutProgress !== undefined
        ? { attempts_without_progress: params.attemptsWithoutProgress }
        : {}),
    },
  });
  return updated.count;
}

async function failImportJobForWorkerPoison(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  nextAttempts: number,
): Promise<void> {
  await markImportJobFailedInTransaction(tx, {
    tenantId,
    jobId,
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
    applyFailureReason: 'poison_cap',
    attemptsWithoutProgress: nextAttempts,
  });
}

async function failImportJobForRetryExhausted(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const count = await markImportJobFailedInTransaction(tx, {
    tenantId,
    jobId,
    where: applyingWorkerLeaseWhere(tenantId, jobId, leaseToken),
    applyFailureReason: 'retry_exhausted',
  });
  return count > 0;
}

async function claimWorkerLeaseInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  phase: ImportWorkerPhase,
): Promise<ImportJobWorkerState | null> {
  const job = await tx.importJob.findFirst({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
  });
  if (!job) {
    return null;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const worker = readWorkerState(options);
  if (!worker || worker.phase !== phase) {
    return null;
  }
  const now = Date.now();
  if (workerLeaseBlocksClaim(worker, now)) {
    return null;
  }
  const cursorAtClaim = importWorkerPoisonProgressCursor(worker);
  const nextAttempts = nextAttemptsWithoutProgress(
    worker,
    cursorAtClaim,
    job.attempts_without_progress,
  );
  if (nextAttempts >= IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS) {
    await failImportJobForWorkerPoison(tx, tenantId, jobId, nextAttempts);
    return null;
  }
  const refreshed: ImportJobWorkerState = {
    ...worker,
    lease_token: randomUUID(),
    lease_until: new Date(now + IMPORT_WORKER_LEASE_MS).toISOString(),
    claimed_processed_rows: cursorAtClaim,
  };
  const locked = await tx.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
      options_json: {
        path: ['worker', 'lease_token'],
        equals: worker.lease_token,
      },
    },
    data: {
      options_json: { ...options, worker: refreshed },
      worker_claim_seq: job.worker_claim_seq + 1,
      attempts_without_progress: nextAttempts,
    },
  });
  if (locked.count === 0) {
    return null;
  }
  return refreshed;
}

/** Reads and writes import jobs and their rows. Every query is scoped to the tenant. */
export class ImportJobStore {
  constructor(private readonly prisma: PrismaService) {}

  findJob(tenantId: string, jobId: string) {
    return this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
  }

  createDryRunJob(input: CreateDryRunJobInput) {
    return this.prisma.importJob.create({
      data: {
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        source_system: input.sourceSystem,
        file_name: input.fileName ?? 'import.csv',
        file_sha256: input.fileSha256,
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping_json: input.mapping,
        options_json: input.options,
        totals_json: input.totals,
        created_by: input.actorUserId,
        rows: { create: input.rows.map(toRowCreate) },
      },
    });
  }

  createPendingBackgroundJob(input: {
    tenantId: string;
    entityType: ImportEntityType;
    sourceSystem: string;
    fileName: string;
    fileSha256: string;
    mapping: Record<string, string>;
    options: ImportJobOptionsWithWorker;
    actorUserId: string;
    upload: ImportJobUploadRef;
    expectedRows: number;
  }) {
    const leaseToken = randomUUID();
    const now = new Date();
    const worker: ImportJobWorkerState = {
      phase: 'dry_run',
      lease_token: leaseToken,
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      started_at: now.toISOString(),
    };
    const totals: ImportJobTotals = {
      rows: input.expectedRows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    return this.prisma.importJob.create({
      data: {
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        source_system: input.sourceSystem,
        file_name: input.fileName,
        file_sha256: input.fileSha256,
        status: ImportJobStatus.APPLYING,
        mapping_json: input.mapping,
        options_json: {
          ...input.options,
          upload: input.upload,
          worker,
        },
        totals_json: totals,
        created_by: input.actorUserId,
      },
    });
  }

  async appendDryRunRows(
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
    return this.prisma.$transaction(async (tx) => {
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

  async beginBackgroundDryRunReconcile(
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
    const updated = await this.prisma.importJob.updateMany({
      where: applyingWorkerLeaseWhere(tenantId, jobId, leaseToken),
      data: {
        options_json: { ...options, worker },
        worker_handoff_at: new Date(),
      },
    });
    return updated.count > 0;
  }

  async finalizeBackgroundDryRunReconcile(
    tenantId: string,
    jobId: string,
    leaseToken: string,
    expectedRows: number,
    options: ImportJobOptionsWithWorker,
  ): Promise<{ totals: ImportJobTotals } | null> {
    const { tallyImportDryRunTotalsFromRows } =
      await import('./import-dry-run-reconcile.totals.js');
    return this.prisma.$transaction(async (tx) => {
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

  async persistDryRunReconcileChunk(
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
      this.prisma.$transaction(
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

    const failed = await this.prisma.$transaction(async (tx) =>
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

  async cancelBackgroundDryRun(tenantId: string, jobId: string) {
    const job = await this.findJob(tenantId, jobId);
    if (!job || job.status !== ImportJobStatus.APPLYING) {
      return { count: 0 };
    }
    const worker = readWorkerState(
      job.options_json as ImportJobOptionsWithWorker,
    );
    if (!worker || worker.phase !== 'dry_run') {
      return { count: 0 };
    }
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.CANCELLED,
        cancelled_at: new Date(),
      },
    });
  }

  async releaseWorkerLeaseForRetry(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const job = await this.findJob(tenantId, jobId);
    if (!job) {
      return false;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (options.worker?.lease_token !== leaseToken) {
      return false;
    }
    const worker = {
      ...options.worker,
      lease_until: new Date(0).toISOString(),
    };
    const updated = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
        options_json: {
          path: ['worker', 'lease_token'],
          equals: leaseToken,
        },
      },
      data: { options_json: { ...options, worker } },
    });
    return updated.count > 0;
  }

  touchWorkerHandoff(tenantId: string, jobId: string) {
    return this.prisma.importJob.updateMany({
      where: { tenant_id: tenantId, id: jobId },
      data: { worker_handoff_at: new Date() },
    });
  }

  async confirmWorkerRecoveryHandoff(
    tenantId: string,
    jobId: string,
    recoverySeq: number,
  ): Promise<void> {
    await this.prisma.importJob.updateMany({
      where: { tenant_id: tenantId, id: jobId },
      data: {
        worker_recovery_seq: recoverySeq,
        worker_handoff_at: new Date(),
      },
    });
  }

  async releaseWorkerLeaseForHandoff(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const job = await this.findJob(tenantId, jobId);
    if (!job) {
      return false;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (options.worker?.lease_token !== leaseToken) {
      return false;
    }
    const worker = {
      ...options.worker,
      lease_until: new Date(0).toISOString(),
    };
    const updated = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
        options_json: {
          path: ['worker', 'lease_token'],
          equals: leaseToken,
        },
      },
      data: {
        options_json: { ...options, worker },
        worker_handoff_at: new Date(),
      },
    });
    return updated.count > 0;
  }

  async extendWorkerLease(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const job = await this.findJob(tenantId, jobId);
    if (!job) {
      return false;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (options.worker?.lease_token !== leaseToken) {
      return false;
    }
    const leaseUntil = new Date(
      Date.now() + IMPORT_WORKER_LEASE_MS,
    ).toISOString();
    const worker = { ...options.worker, lease_until: leaseUntil };
    const updated = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
        options_json: {
          path: ['worker', 'lease_token'],
          equals: leaseToken,
        },
      },
      data: { options_json: { ...options, worker } },
    });
    return updated.count > 0;
  }

  async claimWorkerLease(
    tenantId: string,
    jobId: string,
    phase: ImportWorkerPhase,
  ): Promise<ImportJobWorkerState | null> {
    for (let attempt = 0; attempt < IMPORT_ROW_TX_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => claimWorkerLeaseInTransaction(tx, tenantId, jobId, phase),
          IMPORT_SERIALIZABLE_TX,
        );
      } catch (error) {
        if (!isRetryableTransactionError(error)) {
          throw error;
        }
        if (attempt < IMPORT_ROW_TX_MAX_ATTEMPTS - 1) {
          await delayMs(retryableTransactionDelayMs(attempt));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  findRowsPage(
    where: Prisma.ImportJobRowWhereInput,
    skip: number,
    take: number,
  ) {
    return Promise.all([
      this.prisma.importJobRow.findMany({
        where,
        orderBy: { row_no: 'asc' },
        skip,
        take,
      }),
      this.prisma.importJobRow.count({ where }),
    ]);
  }

  findErrorRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        action: ImportRowAction.ERROR,
      },
      orderBy: { row_no: 'asc' },
    });
  }

  findApplyRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: { tenant_id: tenantId, import_job_id: jobId },
      orderBy: { row_no: 'asc' },
    });
  }

  findApplyRowsAfter(
    tenantId: string,
    jobId: string,
    afterRowNo: number,
    take: number,
  ) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { gt: afterRowNo },
      },
      orderBy: { row_no: 'asc' },
      take,
    });
  }

  findApplyRowsAfterApplySeq(
    tenantId: string,
    jobId: string,
    afterApplySeq: number,
    take: number,
  ) {
    return this.prisma.importJobRow
      .findMany({
        where: {
          tenant_id: tenantId,
          import_job_id: jobId,
          apply_seq: { gt: afterApplySeq, not: null },
        },
        orderBy: { apply_seq: 'asc' },
        take,
      })
      .then((rows) => rows.map(toImportApplyRow));
  }

  async maxApplySeq(tenantId: string, jobId: string): Promise<number> {
    const row = await this.prisma.importJobRow.findFirst({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        apply_seq: { not: null },
      },
      orderBy: { apply_seq: 'desc' },
      select: { apply_seq: true },
    });
    return row?.apply_seq ?? 0;
  }

  countApplyRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.count({
      where: { tenant_id: tenantId, import_job_id: jobId },
    });
  }

  markFailedIfApplying(
    tenantId: string,
    jobId: string,
    totals?: ImportJobTotals,
  ) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.FAILED,
        failed_at: new Date(),
        ...(totals ? { totals_json: totals } : {}),
      },
    });
  }

  finishDryRunIfStillApplying(
    tenantId: string,
    jobId: string,
    data: {
      totals_json: ImportJobTotals;
      options_json: ImportJobOptions;
    },
  ) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.DRY_RUN_DONE,
        totals_json: data.totals_json,
        options_json: data.options_json,
      },
    });
  }

  /** Moves a dry-run job to APPLYING. The status guard makes concurrent applies fail. */
  lockForApply(tenantId: string, jobId: string) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: {
          in: [ImportJobStatus.DRY_RUN_DONE, ImportJobStatus.FAILED],
        },
      },
      data: { status: ImportJobStatus.APPLYING },
    });
  }

  async lockForBackgroundApply(
    tenantId: string,
    jobId: string,
    options: ImportJobOptionsWithWorker,
    dryRunTotals: ImportJobTotals,
    applySequenceOrderKey: ImportApplySequenceOrderKey,
  ) {
    const applyTotals: ImportJobTotals = {
      rows: dryRunTotals.rows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    const leaseToken = randomUUID();
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: leaseToken,
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.importJob.updateMany({
          where: {
            tenant_id: tenantId,
            id: jobId,
            status: {
              in: [ImportJobStatus.DRY_RUN_DONE, ImportJobStatus.FAILED],
            },
          },
          data: {
            status: ImportJobStatus.APPLYING,
            totals_json: applyTotals,
            options_json: { ...options, worker },
            attempts_without_progress: 0,
          },
        });
        if (lock.count === 0) {
          return lock;
        }
        await fillImportJobApplySequences(
          tx,
          tenantId,
          jobId,
          applySequenceOrderKey,
        );
        if (dryRunTotals.rows === 0) {
          await tx.importJob.updateMany({
            where: {
              tenant_id: tenantId,
              id: jobId,
              status: ImportJobStatus.APPLYING,
            },
            data: {
              status: ImportJobStatus.APPLIED,
              appliedAt: new Date(),
            },
          });
        }
        return lock;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}

/** Records a row that failed during apply, with the code and message shown on the row. */
export async function commitApplyWorkerRowInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
  applySeq: number,
): Promise<void> {
  await assertApplyWorkerLease(tx, tenantId, jobId, leaseToken);
  const job = await tx.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const workerState = options.worker;
  if (!workerState) {
    throw new ImportWorkerLeaseLostError();
  }
  const applyWatermark = advanceContiguousApplySeqWatermark(
    workerState.last_committed_apply_seq ?? 0,
    applySeq,
  );
  const worker: ImportJobWorkerState = {
    ...workerState,
    last_committed_apply_seq: applyWatermark,
    processed_rows: applyWatermark,
  };
  await tx.importJob.update({
    where: { id: jobId },
    data: { options_json: { ...options, worker } },
  });
}

/** Records a row that failed during apply, with the code and message shown on the row. */
export function markImportRowFailed(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  rowNo: number,
  error: { code: string; message: string },
) {
  return prisma.importJobRow.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: rowNo,
      },
    },
    data: {
      action: ImportRowAction.ERROR,
      errors_json: [error],
    },
  });
}
