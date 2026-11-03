import { Logger } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import type { ImportApplyFailureReason } from './import-apply.errors.js';
import {
  isImportSyncLegacyApplyPath,
  withImportSyncApplyIoRetry,
} from './import-transaction-retry.util.js';
import { mergeImportJobApplyFailureReason } from './import-apply-failure.util.js';
import {
  readImportJobExpectedRowCount,
  tallyImportApplyTotalsFromRows,
} from './import-apply-persisted-totals.js';
import { logImportJobFailed } from './import-job-failed-log.util.js';
import type { ImportJobView } from './import-job.serializer.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';

export type SupplierJobStateContext = {
  logger: Logger;
  prisma: PrismaService;
  audit: ImportAuditWriter;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The APPLIED transition and its audit entry commit together or not at all. */
export async function markSupplierJobApplied(
  ctx: SupplierJobStateContext,
  input: ImportApplyInput,
  apply: { totals: ImportJobTotals; guardedWrite: boolean },
): Promise<ImportJobView> {
  const { tenantId, job, actorUserId, effectiveOptions } = input;
  const { totals, guardedWrite } = apply;
  return ctx.prisma.$transaction(async (tx) => {
    const { expectedRows, flaggedJumps } = await readImportJobExpectedRowCount(
      tx,
      tenantId,
      job.id,
    );
    const persistedTotals = await tallyImportApplyTotalsFromRows(
      tx,
      tenantId,
      job.id,
      expectedRows || totals.rows,
      flaggedJumps,
    );
    const appliedAt = new Date();
    const data = {
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: persistedTotals,
      options_json: effectiveOptions,
    };
    if (guardedWrite) {
      await tx.importJob.updateMany({
        where: { id: job.id, status: ImportJobStatus.APPLYING },
        data,
      });
      const updatedJob = await tx.importJob.findFirst({
        where: { id: job.id },
      });
      await ctx.audit.writeImportJobAudit(
        tx,
        tenantId,
        actorUserId,
        job.id,
        'applied',
        persistedTotals,
      );
      return updatedJob!;
    }
    const applied = await tx.importJob.update({
      where: { id: job.id },
      data,
    });
    await ctx.audit.writeImportJobAudit(
      tx,
      tenantId,
      actorUserId,
      job.id,
      'applied',
      persistedTotals,
    );
    return applied;
  });
}

/**
 * Chunks that already committed stay applied. The job ends FAILED with the totals of that
 * committed work. The status guard keeps this from overwriting an applied job.
 */
export async function markSupplierJobFailed(
  ctx: SupplierJobStateContext,
  failure: {
    jobId: string;
    totals: ImportJobTotals;
    failureReason: ImportApplyFailureReason;
    cause: string;
    batchOptions?: ImportApplyBatchOptions;
  },
): Promise<void> {
  const { jobId, totals, failureReason, cause, batchOptions } = failure;
  try {
    const persist = async () => {
      const failurePatch = await mergeImportJobApplyFailureReason(
        ctx.prisma,
        jobId,
        failureReason,
      );
      const updated = await ctx.prisma.importJob.updateMany({
        where: { id: jobId, status: ImportJobStatus.APPLYING },
        data: {
          status: ImportJobStatus.FAILED,
          failed_at: new Date(),
          totals_json: totals,
          ...failurePatch,
        },
      });
      if (updated.count > 0) {
        const job = await ctx.prisma.importJob.findFirst({
          where: { id: jobId },
          select: { attempts_without_progress: true },
        });
        logImportJobFailed(ctx.logger, {
          jobId,
          phase: 'apply',
          attempt: job?.attempts_without_progress ?? 0,
          reason: failureReason,
          cause,
        });
      }
    };
    if (
      failureReason === 'retry_exhausted' &&
      isImportSyncLegacyApplyPath(batchOptions)
    ) {
      await withImportSyncApplyIoRetry(true, persist);
      return;
    }
    await persist();
  } catch (markError) {
    ctx.logger.error(
      `Could not mark import job ${jobId} as FAILED: ${describeError(markError)}`,
    );
  }
}
