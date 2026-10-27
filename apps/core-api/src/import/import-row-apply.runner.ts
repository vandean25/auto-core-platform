import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyImportApplyError,
  coerceWriteRowToDomainError,
  ImportApplyRetryExhaustedError,
  ImportDuplicateCreateInJobError,
  resolveImportExternalId,
  toRowApplyError,
  type ImportApplyFailureReason,
} from './import-apply.errors.js';
import { assertApplyRowIsFresh } from './import-apply.freshness.js';
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
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import {
  IMPORT_LOGGER_CONTEXT,
  IMPORT_ROW_TX_MAX_ATTEMPTS,
  IMPORT_SERIALIZABLE_TX,
  IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS,
} from './import.constants.js';
import {
  delayMs,
  isImportSyncLegacyApplyPath,
  retryableTransactionDelayMs,
  withImportSyncApplyIoRetry,
} from './import-transaction-retry.util.js';
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
import { mergeImportJobApplyFailureReason } from './import-apply-failure.util.js';

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

function legacyRowTxMaxAttempts(options?: ImportApplyBatchOptions): number {
  if (options?.leaseToken || options?.stopAfterBatch) {
    return IMPORT_ROW_TX_MAX_ATTEMPTS;
  }
  return IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS;
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
        entityType,
        totals,
        guardedWrite,
        plan.batchIncomplete,
        options,
      );
    } catch (error) {
      await this.recordApplyRunFailure(job.id, totals, guardedWrite, error);
      throw error;
    }
  }

  private async recordApplyRunFailure(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    error: unknown,
  ): Promise<void> {
    const kind = classifyImportApplyError(error);
    if (kind === 'lease_lost' || kind === 'retryable') {
      return;
    }
    const failureReason =
      error instanceof ImportApplyRetryExhaustedError
        ? ('retry_exhausted' satisfies ImportApplyFailureReason)
        : undefined;
    await this.markJobFailed(jobId, totals, guardedWrite, failureReason);
  }

  private async serializeSequenceAppliedJob(
    input: ImportApplyInput,
    entityType: ImportEntityType,
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
    entityType: ImportEntityType,
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
        return this.serializeSequenceAppliedJob(
          input,
          entityType,
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
      await this.audit.writeImportJobAudit(
        this.prisma,
        tenantId,
        actorUserId,
        job.id,
        'applied',
        totals,
      );
      return this.serialize(updatedJob!, totals);
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
        const batchStartedAt = Date.now();
        let appliedInBatch = 0;
        for (const row of batchRows) {
          if (
            options?.chunkDeadlineMs !== undefined &&
            Date.now() > options.chunkDeadlineMs
          ) {
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
    failureReason?: ImportApplyFailureReason,
  ): Promise<void> {
    const failurePatch = failureReason
      ? await mergeImportJobApplyFailureReason(
          this.prisma,
          jobId,
          failureReason,
        )
      : {};
    const data = {
      status: ImportJobStatus.FAILED,
      totals_json: totals,
      failed_at: new Date(),
      ...failurePatch,
    };
    if (guardedWrite) {
      await this.prisma.importJob.updateMany({
        where: { id: jobId, status: ImportJobStatus.APPLYING },
        data,
      });
      return;
    }
    await this.prisma.importJob.update({
      where: { id: jobId },
      data,
    });
  }

  private async earliestCommittedCreateRowNoInJob(
    input: ImportApplyInput,
    row: ImportApplyRow,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<number | null> {
    const payload = row.normalized_json as Record<string, unknown>;
    const externalId = resolveImportExternalId(payload, row.external_id);
    if (!externalId) {
      return null;
    }
    const earliest = await db.importJobRow.findFirst({
      where: {
        tenant_id: input.tenantId,
        import_job_id: input.job.id,
        external_id: externalId,
        action: ImportRowAction.CREATE,
      },
      orderBy: { row_no: 'asc' },
      select: { row_no: true },
    });
    return earliest?.row_no ?? null;
  }

  private async isDuplicateCreateAfterAnotherRowCommitted(
    input: ImportApplyInput,
    row: ImportApplyRow,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<boolean> {
    const earliest = await this.earliestCommittedCreateRowNoInJob(
      input,
      row,
      db,
    );
    return earliest !== null && earliest !== row.row_no;
  }

  private async resolveDuplicateCommittedCreateLegacy(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    row: ImportApplyRow,
  ): Promise<'noop' | 'duplicate_error' | null> {
    if (row.action !== ImportRowAction.CREATE) {
      return null;
    }
    if (!(await this.isCreateAlreadyCommittedByJob(input, entityType, row))) {
      return null;
    }
    if (
      await this.isDuplicateCreateAfterAnotherRowCommitted(
        input,
        row,
        this.prisma,
      )
    ) {
      return 'duplicate_error';
    }
    return 'noop';
  }

  private async isCreateAlreadyCommittedByJob(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    row: ImportApplyRow,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const payload = row.normalized_json as Record<string, unknown>;
    const externalId = resolveImportExternalId(payload, row.external_id);
    const mapping = await db.externalIdMapping.findFirst({
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
    const kind = classifyImportApplyError(error);
    if (kind === 'row') {
      return 'mark_failed';
    }
    if (kind === 'retryable') {
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
      (await this.isCreateAlreadyCommittedByJob(input, entityType, row, tx))
    ) {
      if (
        await this.isDuplicateCreateAfterAnotherRowCommitted(input, row, tx)
      ) {
        throw new ImportDuplicateCreateInJobError();
      }
      return 'noop';
    }
    await assertApplyRowIsFresh(
      tx,
      input.tenantId,
      entityType,
      input.job.source_system,
      row,
    );
    try {
      await writeRow(tx, row);
    } catch (error) {
      throw coerceWriteRowToDomainError(error);
    }
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
    if (
      await this.applyLegacyPreflightRow(
        input,
        entityType,
        row,
        totals,
        options,
      )
    ) {
      return;
    }
    try {
      await this.runLegacyRowRetryLoop(
        input,
        entityType,
        writeRow,
        row,
        totals,
        options,
      );
    } catch (error) {
      throw this.rethrowLegacyApplyError(error, options);
    }
  }

  private async applyLegacyPreflightRow(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options?: ImportApplyBatchOptions,
  ): Promise<boolean> {
    if (row.action === ImportRowAction.ERROR) {
      totals.error += 1;
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
      return true;
    }
    if (row.action === ImportRowAction.SKIP) {
      totals.skip += 1;
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
      return true;
    }
    const committedCreate = await withImportSyncApplyIoRetry(
      isImportSyncLegacyApplyPath(options),
      () => this.resolveDuplicateCommittedCreateLegacy(input, entityType, row),
    );
    if (committedCreate === 'noop') {
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
      return true;
    }
    if (committedCreate === 'duplicate_error') {
      totals.error += 1;
      await markImportRowFailed(
        this.prisma,
        input.tenantId,
        input.job.id,
        row.row_no,
        toRowApplyError(new ImportDuplicateCreateInJobError()),
      );
      await this.advanceWorkerCursor(input, applySeqForRow(row), options);
      return true;
    }
    return false;
  }

  private async runLegacyRowRetryLoop(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    const maxAttempts = legacyRowTxMaxAttempts(options);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.commitLegacyRowTransaction(
          input,
          entityType,
          writeRow,
          row,
          options,
        );
        tallyWrittenRow(totals, row.action);
        return;
      } catch (error) {
        const handled = await this.handleLegacyRowAttemptFailure(
          input,
          row,
          totals,
          options,
          error,
          attempt,
          maxAttempts,
        );
        if (handled) {
          return;
        }
      }
    }
  }

  private async commitLegacyRowTransaction(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await assertApplyRowIsFresh(
        tx,
        input.tenantId,
        entityType,
        input.job.source_system,
        row,
      );
      try {
        await writeRow(tx, row);
      } catch (rowError) {
        throw coerceWriteRowToDomainError(rowError);
      }
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
  }

  private async handleLegacyRowAttemptFailure(
    input: ImportApplyInput,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options: ImportApplyBatchOptions | undefined,
    error: unknown,
    attempt: number,
    maxAttempts: number,
  ): Promise<boolean> {
    const outcome = this.legacyRowAttemptOutcome(error, attempt, maxAttempts);
    if (outcome === 'retry') {
      await delayMs(retryableTransactionDelayMs(attempt));
      return false;
    }
    if (outcome === 'rethrow') {
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
    return true;
  }

  private rethrowLegacyApplyError(
    error: unknown,
    options?: ImportApplyBatchOptions,
  ): unknown {
    if (error instanceof ImportWorkerLeaseLostError) {
      return error;
    }
    if (
      classifyImportApplyError(error) === 'retryable' &&
      legacyRowTxMaxAttempts(options) === IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS
    ) {
      return new ImportApplyRetryExhaustedError(error);
    }
    return error;
  }

  private legacyRowAttemptOutcome(
    error: unknown,
    attempt: number,
    maxAttempts: number,
  ): 'retry' | 'rethrow' | 'mark_failed' {
    const kind = classifyImportApplyError(error);
    if (kind === 'row') {
      return 'mark_failed';
    }
    if (kind === 'retryable') {
      return attempt < maxAttempts - 1 ? 'retry' : 'rethrow';
    }
    return 'rethrow';
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
