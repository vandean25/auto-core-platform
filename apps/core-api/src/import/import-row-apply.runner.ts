import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import {
  ImportEntityType,
  ImportJobStatus,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyImportApplyError,
  describeImportApplyCause,
  ImportApplyRetryExhaustedError,
  type ImportApplyFailureReason,
} from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { applySeqForRow } from './import-apply-sequence.js';
import { persistImportJobApplyingTotals } from './import-job.guarded-persist.util.js';
import { commitApplyWorkerRowInTransaction } from './import-job.store.worker-lease.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import { IMPORT_LOGGER_CONTEXT, IMPORT_SERIALIZABLE_TX } from './import.constants.js';
import {
  isImportSyncLegacyApplyPath,
  withImportSyncApplyIoRetry,
} from './import-transaction-retry.util.js';
import type {
  SerializedImportJob,
  SerializeImportJobFn,
} from './import-job.serializer.js';
import {
  createApplyTotals,
  createResumedApplyTotals,
} from './import-totals.util.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  ImportApplyRow,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';
import {
  readImportJobExpectedRowCount,
  tallyImportApplyTotalsFromRows,
} from './import-apply-persisted-totals.js';
import { mergeImportJobApplyFailureReason } from './import-apply-failure.util.js';
import { logImportJobFailed } from './import-job-failed-log.util.js';
import {
  applyOneLegacy,
  type ImportRowWriter,
  type LegacyRowApplyContext,
} from './import-row-apply.legacy-row.js';
import {
  applyOneWithSequence,
  type SequenceApplyRowContext,
} from './import-row-apply.sequence-row.js';

export type { ImportRowWriter } from './import-row-apply.legacy-row.js';

function isPastApplyUnitDeadline(deadlineMs: number | undefined): boolean {
  return deadlineMs !== undefined && Date.now() > deadlineMs;
}

/**
 * Applies a job one row at a time, each row in its own transaction. Row-level data problems
 * become ERROR rows; transaction contention and timeouts are retried or rethrown. A failure
 * outside the rows marks the job FAILED and is rethrown. Customer and vehicle imports use
 * this runner.
 */
export class RowByRowApplyRunner {
  private readonly logger = new Logger(IMPORT_LOGGER_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditWriter,
    private readonly serialize: SerializeImportJobFn,
  ) {}

  async run(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    options?: ImportApplyBatchOptions,
  ): Promise<SerializedImportJob> {
    const { job, rows } = input;
    const storedTotals = job.totals_json as ImportJobTotals | null;
    const totals =
      options?.stopAfterBatch && storedTotals
        ? createResumedApplyTotals(rows.length, storedTotals)
        : createApplyTotals(Math.max(rows.length, storedTotals?.rows ?? 0));
    const plan = planImportApplyBatch(rows, options);
    const guardedWrite = Boolean(options?.stopAfterBatch);

    try {
      const stoppedEarly = await this.runApplyBatchSpan(
        input,
        entityType,
        writeRow,
        plan.batchRows,
        totals,
        plan.resumeAfter,
        options,
      );
      return await this.finishApplyRun(
        input,
        totals,
        guardedWrite,
        plan.batchIncomplete || stoppedEarly,
        options,
      );
    } catch (error) {
      await this.recordApplyRunFailure(
        job.id,
        totals,
        guardedWrite,
        error,
        options,
      );
      throw error;
    }
  }

  private async recordApplyRunFailure(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    error: unknown,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    const kind = classifyImportApplyError(error);
    if (kind === 'lease_lost' || kind === 'retryable') {
      return;
    }
    const current = await this.prisma.importJob.findFirst({
      where: { id: jobId },
      select: { status: true },
    });
    if (current?.status === ImportJobStatus.APPLIED) {
      return;
    }
    const failureReason: ImportApplyFailureReason =
      error instanceof ImportApplyRetryExhaustedError
        ? 'retry_exhausted'
        : 'apply_error';
    await this.markJobFailed(
      jobId,
      totals,
      guardedWrite,
      failureReason,
      options,
      describeImportApplyCause(error),
    );
  }

  private async serializeSequenceAppliedJob(
    input: ImportApplyInput,
    totals: ImportJobTotals,
    refreshed: NonNullable<
      Awaited<ReturnType<PrismaService['importJob']['findFirst']>>
    >,
  ): Promise<SerializedImportJob> {
    const { tenantId, job, actorUserId } = input;
    const appliedTotals = (refreshed.totals_json as ImportJobTotals) ?? totals;
    await this.audit.writeImportJobAudit(
      this.prisma,
      tenantId,
      actorUserId,
      job.id,
      'applied',
      appliedTotals,
    );
    return this.serialize(refreshed, appliedTotals);
  }

  private async finishApplyRun(
    input: ImportApplyInput,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    batchIncomplete: boolean,
    options?: ImportApplyBatchOptions,
  ): Promise<SerializedImportJob> {
    const { tenantId, job, actorUserId } = input;
    if (options?.useApplySequence) {
      const refreshed = await this.prisma.importJob.findFirst({
        where: { id: job.id },
      });
      const appliedTotals =
        (refreshed?.totals_json as ImportJobTotals) ?? totals;
      if (refreshed?.status === ImportJobStatus.APPLIED) {
        return this.serializeSequenceAppliedJob(
          input,
          totals,
          refreshed,
        );
      }
      // Row commits already persist totals_json; do not overwrite with batch-local totals.
      return this.serialize(refreshed!, appliedTotals);
    }
    if (batchIncomplete) {
      const partialJob = await persistImportJobApplyingTotals(
        this.prisma,
        job.id,
        totals,
        guardedWrite,
      );
      return this.serialize(partialJob!, totals);
    }
    const syncPath = isImportSyncLegacyApplyPath(options);
    return withImportSyncApplyIoRetry(syncPath, async () => {
      const updatedJob = await this.markJobApplied(
        job.id,
        totals,
        guardedWrite,
      );
      const appliedTotals =
        (updatedJob?.totals_json as ImportJobTotals) ?? totals;
      await this.audit.writeImportJobAudit(
        this.prisma,
        tenantId,
        actorUserId,
        job.id,
        'applied',
        appliedTotals,
      );
      return this.serialize(updatedJob!, appliedTotals);
    });
  }

  private async runApplyBatchSpan(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    batchRows: ImportApplyRow[],
    totals: ImportJobTotals,
    resumeAfter: number,
    options?: ImportApplyInput['batchOptions'],
  ): Promise<boolean> {
    return Sentry.startSpan(
      {
        name: 'Import apply batch',
        op: 'import.apply.batch',
        attributes: {
          jobId: input.job.id,
          batchSize: batchRows.length,
          resumeAfterApplySeq: resumeAfter,
        },
      },
      async () => {
        const batchStartedAt = Date.now();
        let appliedInBatch = 0;
        let stoppedEarly = false;
        for (const row of batchRows) {
          if (isPastApplyUnitDeadline(options?.chunkDeadlineMs)) {
            stoppedEarly = true;
            break;
          }
          await this.applyOne(
            input,
            entityType,
            writeRow,
            row,
            totals,
            options,
          );
          appliedInBatch += 1;
        }
        if (options?.stopAfterBatch) {
          this.logger.log(
            JSON.stringify({
              metric: 'import.worker.batch_duration_ms',
              jobId: input.job.id,
              durationMs: Date.now() - batchStartedAt,
              rowsApplied: appliedInBatch,
            }),
          );
        }
        return stoppedEarly;
      },
    );
  }

  private async markJobApplied(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.importJob.findFirst({
        where: { id: jobId },
        select: { tenant_id: true },
      });
      if (!job) {
        return null;
      }
      const { expectedRows, flaggedJumps } =
        await readImportJobExpectedRowCount(tx, job.tenant_id, jobId);
      const persistedTotals = await tallyImportApplyTotalsFromRows(
        tx,
        job.tenant_id,
        jobId,
        expectedRows || totals.rows,
        flaggedJumps,
      );
      const appliedAt = new Date();
      const data = {
        status: ImportJobStatus.APPLIED,
        appliedAt,
        totals_json: persistedTotals,
      };
      if (guardedWrite) {
        await tx.importJob.updateMany({
          where: { id: jobId, status: ImportJobStatus.APPLYING },
          data,
        });
        return tx.importJob.findFirst({ where: { id: jobId } });
      }
      return tx.importJob.update({
        where: { id: jobId },
        data,
      });
    });
  }

  private async markJobFailed(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    failureReason: ImportApplyFailureReason,
    options?: ImportApplyBatchOptions,
    cause?: string,
  ): Promise<void> {
    const persist = async () => {
      const failurePatch = await mergeImportJobApplyFailureReason(
        this.prisma,
        jobId,
        failureReason,
      );
      const data = {
        status: ImportJobStatus.FAILED,
        totals_json: totals,
        failed_at: new Date(),
        ...failurePatch,
      };
      const didMarkFailed = guardedWrite
        ? (
            await this.prisma.importJob.updateMany({
              where: { id: jobId, status: ImportJobStatus.APPLYING },
              data,
            })
          ).count > 0
        : await this.prisma.importJob
            .update({
              where: { id: jobId },
              data,
            })
            .then(() => true)
            .catch(() => false);
      if (didMarkFailed) {
        const job = await this.prisma.importJob.findFirst({
          where: { id: jobId },
          select: { attempts_without_progress: true },
        });
        logImportJobFailed(this.logger, {
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
      isImportSyncLegacyApplyPath(options)
    ) {
      await withImportSyncApplyIoRetry(true, persist);
      return;
    }
    await persist();
  }

  private async applyOne(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    if (options?.useApplySequence) {
      const ctx: SequenceApplyRowContext = {
        logger: this.logger,
        prisma: this.prisma,
      };
      await applyOneWithSequence(
        ctx,
        input,
        entityType,
        writeRow,
        row,
        totals,
        options,
      );
      return;
    }
    await applyOneLegacy(
      this.legacyRowContext(),
      input,
      entityType,
      writeRow,
      row,
      totals,
      options,
    );
  }

  private legacyRowContext(): LegacyRowApplyContext {
    return {
      logger: this.logger,
      prisma: this.prisma,
      advanceWorkerCursor: (input, row, options) =>
        this.advanceWorkerCursor(input, row, options),
    };
  }

  private async advanceWorkerCursor(
    input: ImportApplyInput,
    row: ImportApplyRow,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    const leaseToken = options?.leaseToken;
    if (!leaseToken) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await commitApplyWorkerRowInTransaction(
        tx,
        input.tenantId,
        input.job.id,
        leaseToken,
        applySeqForRow(row),
        row.row_no,
      );
    }, IMPORT_SERIALIZABLE_TX);
  }
}
