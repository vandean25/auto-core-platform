import { randomUUID } from 'node:crypto';
import { ImportJobStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  applyLockForReapply,
  resetTechnicalImportErrorRows,
} from './import-technical-retry.js';
import type {
  ImportJobOptionsWithWorker,
  ImportJobWorkerState,
} from './import-job.worker-state.js';
import { fillImportJobApplySequences } from './import-apply-sequence-fill.js';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';
import type { ImportJobTotals } from './import.types.js';

/** Moves a job into APPLYING under an optimistic lock and prepares its apply sequences. */

type LockTxClient = {
  importJob: Pick<Prisma.TransactionClient['importJob'], 'findFirst'>;
};

async function loadEligibleJobForApplyLock(
  tx: LockTxClient,
  tenantId: string,
  jobId: string,
  allowedStatuses: ImportJobStatus[],
): Promise<
  | { eligible: false }
  | { eligible: true; options: Record<string, unknown>; updatedAt: Date }
> {
  const current = await tx.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
    select: { status: true, options_json: true, updatedAt: true },
  });
  if (!current || !allowedStatuses.includes(current.status)) {
    return { eligible: false };
  }
  const opts = (current.options_json ?? {}) as Record<string, unknown>;
  if (opts.rows_purged === true || opts.cancel_reason === 'expired') {
    return { eligible: false };
  }
  return { eligible: true, options: opts, updatedAt: current.updatedAt };
}

/** Moves a dry-run job to APPLYING and holds the apply lease. */
export async function lockForApply(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  extraStatuses: ImportJobStatus[] = [],
  optionsOverride?: ImportJobOptionsWithWorker,
) {
  const existing = optionsOverride
    ? null
    : await prisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
  const options =
    optionsOverride ??
    ((existing?.options_json ?? {}) as ImportJobOptionsWithWorker);
  const locked = applyLockForReapply(options, extraStatuses, Date.now());
  return prisma.$transaction(async (tx) => {
    const lockCheck = await loadEligibleJobForApplyLock(
      tx,
      tenantId,
      jobId,
      locked.statuses,
    );
    if (!lockCheck.eligible) {
      return { count: 0 };
    }
    const lock = await tx.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: { in: locked.statuses },
        updatedAt: lockCheck.updatedAt,
      },
      data: {
        status: ImportJobStatus.APPLYING,
        options_json: {
          ...lockCheck.options,
          ...locked.options,
        },
      },
    });
    if (lock.count === 0) {
      return lock;
    }
    await resetTechnicalImportErrorRows(
      tx,
      tenantId,
      jobId,
      locked.options.worker?.technical_retry_row_nos ?? [],
    );
    return lock;
  });
}

export async function lockForBackgroundApply(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  options: ImportJobOptionsWithWorker,
  dryRunTotals: ImportJobTotals,
  applySequenceOrderKey: ImportApplySequenceOrderKey,
) {
  const previousCursor = options.worker?.last_committed_apply_seq ?? 0;
  const retryRowNos = options.technical_retry_row_nos ?? [];
  const reapply = previousCursor > 0 || retryRowNos.length > 0;
  const applyTotals: ImportJobTotals = reapply
    ? dryRunTotals
    : {
        rows: dryRunTotals.rows,
        create: 0,
        update: 0,
        skip: 0,
        error: 0,
      };
  const leaseToken = randomUUID();
  const optionsWithoutRetry = { ...options };
  delete optionsWithoutRetry.technical_retry_row_nos;
  const worker: ImportJobWorkerState = {
    phase: 'apply',
    lease_token: leaseToken,
    lease_until: new Date(0).toISOString(),
    processed_rows: previousCursor,
    last_committed_apply_seq: previousCursor,
    started_at: new Date().toISOString(),
    ...(retryRowNos.length > 0 ? { technical_retry_row_nos: retryRowNos } : {}),
  };
  const lockStatuses: ImportJobStatus[] = [
    ImportJobStatus.DRY_RUN_DONE,
    ImportJobStatus.FAILED,
    ...(retryRowNos.length > 0 ? [ImportJobStatus.APPLIED] : []),
  ];
  return prisma.$transaction(
    async (tx) => {
      const lockCheck = await loadEligibleJobForApplyLock(
        tx,
        tenantId,
        jobId,
        lockStatuses,
      );
      if (!lockCheck.eligible) {
        return { count: 0 };
      }
      const lock = await tx.importJob.updateMany({
        where: {
          tenant_id: tenantId,
          id: jobId,
          status: { in: lockStatuses },
          updatedAt: lockCheck.updatedAt,
        },
        data: {
          status: ImportJobStatus.APPLYING,
          totals_json: applyTotals,
          options_json: {
            ...lockCheck.options,
            ...optionsWithoutRetry,
            worker,
          },
          attempts_without_progress: 0,
        },
      });
      if (lock.count === 0) {
        return lock;
      }
      await resetTechnicalImportErrorRows(
        tx,
        tenantId,
        jobId,
        worker.technical_retry_row_nos ?? [],
      );
      await fillImportJobApplySequences(
        tx,
        tenantId,
        jobId,
        applySequenceOrderKey,
      );
      if (dryRunTotals.rows === 0) {
        const { tallyImportApplyTotalsFromRows } =
          await import('./import-apply-persisted-totals.js');
        const persistedTotals = await tallyImportApplyTotalsFromRows(
          tx,
          tenantId,
          jobId,
          0,
        );
        await tx.importJob.updateMany({
          where: {
            tenant_id: tenantId,
            id: jobId,
            status: ImportJobStatus.APPLYING,
          },
          data: {
            status: ImportJobStatus.APPLIED,
            appliedAt: new Date(),
            totals_json: persistedTotals,
          },
        });
      }
      return lock;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
