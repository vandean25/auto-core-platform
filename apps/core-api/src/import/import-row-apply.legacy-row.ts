import { Logger } from '@nestjs/common';
import { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyImportApplyError,
  coerceWriteRowToDomainError,
  describeImportApplyCause,
  ImportApplyRetryExhaustedError,
  ImportDuplicateCreateInJobError,
  toRowApplyError,
} from './import-apply.errors.js';
import { resolveDuplicateCommittedCreateLegacy } from './import-apply-duplicate-create.js';
import { assertApplyRowIsFresh } from './import-apply.freshness.js';
import { applySeqForRow } from './import-apply-sequence.js';
import { commitApplyWorkerRowInTransaction } from './import-job.store.worker-lease.js';
import { markImportRowFailed } from './import-job.store.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
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
import { tallyWrittenRow } from './import-totals.util.js';
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

export type LegacyRowApplyContext = {
  logger: Logger;
  prisma: PrismaService;
  /** Moves the worker cursor past a row the caller has already accounted for. */
  advanceWorkerCursor: (
    input: ImportApplyInput,
    row: ImportApplyRow,
    options?: ImportApplyBatchOptions,
  ) => Promise<void>;
};

function legacyRowTxMaxAttempts(options?: ImportApplyBatchOptions): number {
  if (options?.stopAfterBatch || options?.useApplySequence) {
    return IMPORT_ROW_TX_MAX_ATTEMPTS;
  }
  return IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS;
}

/**
 * Interactive (non worker-sequenced) apply of a single row: planned ERROR/SKIP rows are
 * only tallied, a CREATE already committed by this job becomes a no-op or a duplicate
 * error, everything else is written in its own serializable transaction with retries.
 */
export async function applyOneLegacy(
  ctx: LegacyRowApplyContext,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  writeRow: ImportRowWriter,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  options?: ImportApplyBatchOptions,
): Promise<void> {
  if (
    await applyLegacyPreflightRow(ctx, input, entityType, row, totals, options)
  ) {
    return;
  }
  try {
    await runLegacyRowRetryLoop(
      ctx,
      input,
      entityType,
      writeRow,
      row,
      totals,
      options,
    );
  } catch (error) {
    throw rethrowLegacyApplyError(error, options);
  }
}

async function applyLegacyPreflightRow(
  ctx: LegacyRowApplyContext,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  options?: ImportApplyBatchOptions,
): Promise<boolean> {
  if (row.action === ImportRowAction.ERROR) {
    totals.error += 1;
    await ctx.advanceWorkerCursor(input, row, options);
    return true;
  }
  if (row.action === ImportRowAction.SKIP) {
    totals.skip += 1;
    await ctx.advanceWorkerCursor(input, row, options);
    return true;
  }
  const committedCreate = await withImportSyncApplyIoRetry(
    isImportSyncLegacyApplyPath(options),
    () =>
      resolveDuplicateCommittedCreateLegacy(ctx.prisma, input, entityType, row),
  );
  if (committedCreate === 'noop') {
    tallyWrittenRow(totals, row.action);
    await ctx.advanceWorkerCursor(input, row, options);
    return true;
  }
  if (committedCreate === 'duplicate_error') {
    totals.error += 1;
    await markImportRowFailed(
      ctx.prisma,
      input.tenantId,
      input.job.id,
      row.row_no,
      toRowApplyError(new ImportDuplicateCreateInJobError()),
    );
    await ctx.advanceWorkerCursor(input, row, options);
    return true;
  }
  return false;
}

async function runLegacyRowRetryLoop(
  ctx: LegacyRowApplyContext,
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
      await commitLegacyRowTransaction(
        ctx,
        input,
        entityType,
        writeRow,
        row,
        options,
      );
      tallyWrittenRow(totals, row.action);
      return;
    } catch (error) {
      const handled = await handleLegacyRowAttemptFailure(
        ctx,
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

async function commitLegacyRowTransaction(
  ctx: LegacyRowApplyContext,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  writeRow: ImportRowWriter,
  row: ImportApplyRow,
  options?: ImportApplyBatchOptions,
): Promise<void> {
  await ctx.prisma.$transaction(async (tx) => {
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
        row.row_no,
      );
    }
  }, IMPORT_SERIALIZABLE_TX);
}

async function handleLegacyRowAttemptFailure(
  ctx: LegacyRowApplyContext,
  input: ImportApplyInput,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  options: ImportApplyBatchOptions | undefined,
  error: unknown,
  attempt: number,
  maxAttempts: number,
): Promise<boolean> {
  const outcome = legacyRowAttemptOutcome(error, attempt, maxAttempts);
  if (outcome === 'retry') {
    await delayMs(retryableTransactionDelayMs(attempt));
    return false;
  }
  if (outcome === 'rethrow') {
    throw error;
  }
  ctx.logger.warn(
    `Import apply row failed jobId=${input.job.id} rowNo=${row.row_no} cause=${describeImportApplyCause(error)}`,
  );
  totals.error += 1;
  await markImportRowFailed(
    ctx.prisma,
    input.tenantId,
    input.job.id,
    row.row_no,
    toRowApplyError(error),
  );
  await ctx.advanceWorkerCursor(input, row, options);
  return true;
}

function rethrowLegacyApplyError(
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

function legacyRowAttemptOutcome(
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
