import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';
import {
  isRowLevelApplyError,
  toRowApplyError,
} from './import-apply.errors.js';
import { assertApplyRowIsFresh } from './import-apply.freshness.js';
import { resolveImportExternalId } from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { applySeqForRow } from './import-apply-sequence.js';
import {
  assertApplyWorkerLease,
  commitBackgroundApplyRowInTransaction,
} from './import-background-apply.commit.js';
import { persistImportJobApplyingTotals } from './import-job.guarded-persist.util.js';
import {
  commitApplyWorkerRowInTransaction,
  markImportRowFailed,
} from './import-job.store.js';
import {
  ImportWorkerLeaseLostError,
  isImportWorkerContentionError,
} from './import-worker.errors.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import {
  IMPORT_LOGGER_CONTEXT,
  IMPORT_ROW_TX_MAX_ATTEMPTS,
  IMPORT_SERIALIZABLE_TX,
} from './import.constants.js';
import type {
  SerializedImportJob,
  SerializeImportJobFn,
} from './import-job.serializer.js';
import {
  createApplyTotals,
  createResumedApplyTotals,
  importTotalsAfterApplyRowTally,
  type ImportApplyRowTally,
  tallyWrittenRow,
} from './import-totals.util.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  ImportApplyRow,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';

/** Writes one planned row inside the transaction that also runs the freshness check. */
export type ImportRowWriter = (
  tx: Prisma.TransactionClient,
  row: ImportApplyRow,
) => Promise<void>;

function describeCause(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

function isBackgroundWorkerApply(options?: ImportApplyBatchOptions): boolean {
  return Boolean(options?.leaseToken || options?.useApplySequence);
}

function retryableTransactionDelayMs(attempt: number): number {
  const cappedBase = Math.min(50 * 2 ** attempt, 2000);
  const jitter = Math.floor(Math.random() * cappedBase * 0.25);
  return cappedBase + jitter;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
      await this.runApplyBatchSpan(
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
        plan.batchIncomplete,
        options,
      );
    } catch (error) {
      if (this.shouldRethrowApplyRunError(error)) {
        throw error;
      }
      await this.markJobFailed(job.id, totals, guardedWrite);
      throw error;
    }
  }

  private shouldRethrowApplyRunError(error: unknown): boolean {
    return (
      error instanceof ImportWorkerLeaseLostError ||
      isImportWorkerContentionError(error)
    );
  }

  private async finishApplyRun(
    input: ImportApplyInput,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    batchIncomplete: boolean,
    options?: ImportApplyBatchOptions,
  ): Promise<SerializedImportJob> {
    const { tenantId, job, actorUserId } = input;
    const refreshed = await this.prisma.importJob.findFirst({
      where: { id: job.id },
    });
    if (options?.useApplySequence) {
      const appliedTotals =
        (refreshed?.totals_json as ImportJobTotals) ?? totals;
      if (refreshed?.status === ImportJobStatus.APPLIED) {
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
      const partialJob = await persistImportJobApplyingTotals(
        this.prisma,
        job.id,
        totals,
        guardedWrite,
      );
      return this.serialize(partialJob!, appliedTotals);
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
    const updatedJob = await this.markJobApplied(job.id, totals, guardedWrite);
    await this.audit.writeImportJobAudit(
      this.prisma,
      tenantId,
      actorUserId,
      job.id,
      'applied',
      totals,
    );
    return this.serialize(updatedJob!, totals);
  }

  private async runApplyBatchSpan(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    batchRows: ImportApplyRow[],
    totals: ImportJobTotals,
    resumeAfter: number,
    options?: ImportApplyInput['batchOptions'],
  ): Promise<void> {
    await Sentry.startSpan(
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
        for (const row of batchRows) {
          await this.applyOne(
            input,
            entityType,
            writeRow,
            row,
            totals,
            options,
          );
        }
      },
    );
  }

  private async markJobApplied(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
  ) {
    if (guardedWrite) {
      await this.prisma.importJob.updateMany({
        where: { id: jobId, status: ImportJobStatus.APPLYING },
        data: {
          status: ImportJobStatus.APPLIED,
          appliedAt: new Date(),
          totals_json: totals,
        },
      });
      return this.prisma.importJob.findFirst({ where: { id: jobId } });
    }
    return this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: ImportJobStatus.APPLIED,
        appliedAt: new Date(),
        totals_json: totals,
      },
    });
  }

  private async markJobFailed(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
  ): Promise<void> {
    if (guardedWrite) {
      await this.prisma.importJob.updateMany({
        where: { id: jobId, status: ImportJobStatus.APPLYING },
        data: { status: ImportJobStatus.FAILED, totals_json: totals },
      });
      return;
    }
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: ImportJobStatus.FAILED, totals_json: totals },
    });
  }

  private async isCreateAlreadyCommittedByJob(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    row: ImportApplyRow,
  ): Promise<boolean> {
    const payload = row.normalized_json as Record<string, unknown>;
    const externalId = resolveImportExternalId(payload, row.external_id);
    const mapping = await this.prisma.externalIdMapping.findFirst({
      where: {
        tenant_id: input.tenantId,
        entity_type: entityType,
        source_system: input.job.source_system,
        external_id: externalId,
      },
      select: { first_seen_import_job_id: true },
    });
    return mapping?.first_seen_import_job_id === input.job.id;
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
      await this.applyOneWithSequence(
        input,
        entityType,
        writeRow,
        row,
        totals,
        options,
      );
      return;
    }
    await this.applyOneLegacy(
      input,
      entityType,
      writeRow,
      row,
      totals,
      options,
    );
  }

  private async applyOneWithSequence(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options: ImportApplyBatchOptions,
  ): Promise<void> {
    const applySeq = row.apply_seq;
    const leaseToken = options.leaseToken;
    const maxApplySeq = options.maxApplySeq;
    if (applySeq == null || !leaseToken || maxApplySeq == null) {
      throw new Error('Background apply row is missing apply_seq');
    }
    if (maxApplySeq === 0) {
      throw new Error('Background apply job has no apply_seq assigned');
    }
    for (let attempt = 0; attempt < IMPORT_ROW_TX_MAX_ATTEMPTS; attempt++) {
      try {
        const { nextTotals } = await this.commitImportSequenceRow(
          input,
          entityType,
          writeRow,
          row,
          totals,
          leaseToken,
          applySeq,
          maxApplySeq,
        );
        Object.assign(totals, nextTotals);
        return;
      } catch (error) {
        const outcome = this.sequenceRowAttemptOutcome(error, attempt);
        if (outcome === 'retry') {
          await delayMs(retryableTransactionDelayMs(attempt));
          continue;
        }
        if (outcome === 'rethrow') {
          throw error;
        }
        const nextTotals = await this.markImportSequenceRowFailed(
          input,
          row,
          totals,
          leaseToken,
          applySeq,
          maxApplySeq,
          error,
        );
        Object.assign(totals, nextTotals);
        return;
      }
    }
  }

  private sequenceRowAttemptOutcome(
    error: unknown,
    attempt: number,
  ): 'retry' | 'rethrow' | 'mark_failed' {
    if (error instanceof ImportWorkerLeaseLostError) {
      return 'rethrow';
    }
    if (isRowLevelApplyError(error)) {
      return 'mark_failed';
    }
    if (isRetryableTransactionError(error)) {
      return attempt < IMPORT_ROW_TX_MAX_ATTEMPTS - 1 ? 'retry' : 'rethrow';
    }
    return 'rethrow';
  }

  private async commitImportSequenceRow(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    leaseToken: string,
    applySeq: number,
    maxApplySeq: number,
  ): Promise<{ nextTotals: ImportJobTotals }> {
    return this.prisma.$transaction(async (tx) => {
      await assertApplyWorkerLease(
        tx,
        input.tenantId,
        input.job.id,
        leaseToken,
      );
      const rowTally = await this.applyRowBodyInTransaction(
        tx,
        input,
        entityType,
        writeRow,
        row,
      );
      const nextTotals = importTotalsAfterApplyRowTally(
        totals,
        row.action,
        rowTally,
      );
      await commitBackgroundApplyRowInTransaction(tx, {
        tenantId: input.tenantId,
        jobId: input.job.id,
        leaseToken,
        applySeq,
        totals: nextTotals,
        maxApplySeq,
      });
      return { nextTotals };
    }, IMPORT_SERIALIZABLE_TX);
  }

  private async markImportSequenceRowFailed(
    input: ImportApplyInput,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    leaseToken: string,
    applySeq: number,
    maxApplySeq: number,
    error: unknown,
  ): Promise<ImportJobTotals> {
    this.logger.warn(
      `Import apply row failed jobId=${input.job.id} rowNo=${row.row_no} cause=${describeCause(error)}`,
    );
    const nextTotals = importTotalsAfterApplyRowTally(
      totals,
      row.action,
      'error',
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.importJobRow.update({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: input.tenantId,
            import_job_id: input.job.id,
            row_no: row.row_no,
          },
        },
        data: {
          action: ImportRowAction.ERROR,
          errors_json: [toRowApplyError(error)],
        },
      });
      await commitBackgroundApplyRowInTransaction(tx, {
        tenantId: input.tenantId,
        jobId: input.job.id,
        leaseToken,
        applySeq,
        totals: nextTotals,
        maxApplySeq,
      });
    }, IMPORT_SERIALIZABLE_TX);
    return nextTotals;
  }

  private async applyRowBodyInTransaction(
    tx: Prisma.TransactionClient,
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
  ): Promise<ImportApplyRowTally> {
    if (row.action === ImportRowAction.ERROR) {
      return 'error';
    }
    if (row.action === ImportRowAction.SKIP) {
      return 'skip';
    }
    if (
      row.action === ImportRowAction.CREATE &&
      (await this.isCreateAlreadyCommittedByJob(input, entityType, row))
    ) {
      return 'noop';
    }
    await assertApplyRowIsFresh(
      tx,
      input.tenantId,
      entityType,
      input.job.source_system,
      row,
    );
    await writeRow(tx, row);
    return 'written';
  }

  private async applyOneLegacy(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    if (row.action === ImportRowAction.ERROR) {
      totals.error += 1;
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
      return;
    }
    if (row.action === ImportRowAction.SKIP) {
      totals.skip += 1;
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
      return;
    }

    try {
      if (
        row.action === ImportRowAction.CREATE &&
        (await this.isCreateAlreadyCommittedByJob(input, entityType, row))
      ) {
        await this.advanceWorkerCursor(input, applySeqForRow(row), options);
        return;
      }
      await this.prisma.$transaction(async (tx) => {
        await assertApplyRowIsFresh(
          tx,
          input.tenantId,
          entityType,
          input.job.source_system,
          row,
        );
        await writeRow(tx, row);
        if (options?.onRowCommitted && options.leaseToken) {
          await options.onRowCommitted(tx, row.row_no);
        } else if (options?.leaseToken) {
          await commitApplyWorkerRowInTransaction(
            tx,
            input.tenantId,
            input.job.id,
            options.leaseToken,
            applySeqForRow(row),
          );
        }
      }, IMPORT_SERIALIZABLE_TX);
      tallyWrittenRow(totals, row.action);
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        throw error;
      }
      if (!isRowLevelApplyError(error) && isBackgroundWorkerApply(options)) {
        throw error;
      }
      this.logger.warn(
        `Import apply row failed jobId=${input.job.id} rowNo=${row.row_no} cause=${describeCause(error)}`,
      );
      totals.error += 1;
      await markImportRowFailed(
        this.prisma,
        input.tenantId,
        input.job.id,
        row.row_no,
        toRowApplyError(error),
      );
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
    }
  }

  private async advanceWorkerCursor(
    input: ImportApplyInput,
    applySeq: number,
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
        applySeq,
      );
    }, IMPORT_SERIALIZABLE_TX);
  }
}
