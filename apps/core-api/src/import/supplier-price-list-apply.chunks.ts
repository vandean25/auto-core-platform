import { Logger } from '@nestjs/common';
import { ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyImportApplyError,
  ImportApplyRetryExhaustedError,
  isRowLevelApplyError,
  toRowApplyError,
} from './import-apply.errors.js';
import { commitApplyWorkerRowInTransaction } from './import-job.store.worker-lease.js';
import { markImportRowFailed } from './import-job.store.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import { applySeqForRow } from './import-apply-sequence.js';
import { IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS } from './import.constants.js';
import {
  delayMs,
  isImportSyncLegacyApplyPath,
  retryableTransactionDelayMs,
} from './import-transaction-retry.util.js';
import { createApplyTotals, tallyWrittenRow } from './import-totals.util.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  ImportApplyRow,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';
import {
  applySupplierImportRow,
  type SupplierApplyContext,
} from './supplier-price-list-import.apply.js';

/** Rows per transaction. A failing chunk is retried row by row. */
const CHUNK_SIZE = 50;
const CHUNK_TRANSACTION_OPTIONS = { timeout: 30000, maxWait: 10000 };

export type SupplierChunkApplyContext = {
  logger: Logger;
  prisma: PrismaService;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addCounts(totals: ImportJobTotals, counts: ImportJobTotals): void {
  totals.create += counts.create;
  totals.update += counts.update;
  totals.skip += counts.skip;
  totals.error += counts.error;
}

async function commitWorkerRow(
  tx: Prisma.TransactionClient,
  input: ImportApplyInput,
  row: ImportApplyRow,
  batchOptions?: ImportApplyBatchOptions,
): Promise<void> {
  if (!batchOptions?.leaseToken) {
    return;
  }
  await commitApplyWorkerRowInTransaction(
    tx,
    input.tenantId,
    input.job.id,
    batchOptions.leaseToken,
    applySeqForRow(row),
    row.row_no,
  );
}

async function advanceWorkerCursor(
  prisma: PrismaService,
  input: ImportApplyInput,
  row: ImportApplyRow,
  batchOptions?: ImportApplyBatchOptions,
): Promise<void> {
  if (!batchOptions?.leaseToken) {
    return;
  }
  await prisma.$transaction(async (tx) => {
    await commitWorkerRow(tx, input, row, batchOptions);
  });
}

async function applyChunkRows(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  chunk: ImportApplyRow[],
  input: ImportApplyInput,
  batchOptions?: ImportApplyBatchOptions,
): Promise<ImportJobTotals> {
  const counts = createApplyTotals(0);
  for (const row of chunk) {
    if (row.action === ImportRowAction.ERROR) {
      counts.error += 1;
      await commitWorkerRow(tx, input, row, batchOptions);
    } else if (row.action === ImportRowAction.SKIP) {
      counts.skip += 1;
      await commitWorkerRow(tx, input, row, batchOptions);
    } else {
      const result = await applySupplierImportRow(tx, ctx, row);
      tallyWrittenRow(counts, result.action);
      await commitWorkerRow(tx, input, row, batchOptions);
    }
  }
  return counts;
}

/** Fallback for one row after its chunk failed. Only row-level failures are kept as ERROR. */
async function applyRowAlone(
  ctx: SupplierChunkApplyContext,
  input: ImportApplyInput,
  supplierCtx: SupplierApplyContext,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  batchOptions?: ImportApplyBatchOptions,
): Promise<void> {
  if (row.action === ImportRowAction.ERROR) {
    totals.error += 1;
    await advanceWorkerCursor(ctx.prisma, input, row, batchOptions);
    return;
  }
  if (row.action === ImportRowAction.SKIP) {
    totals.skip += 1;
    await advanceWorkerCursor(ctx.prisma, input, row, batchOptions);
    return;
  }

  if (isImportSyncLegacyApplyPath(batchOptions)) {
    await applyRowAloneWithSyncRetry(
      ctx,
      input,
      supplierCtx,
      row,
      totals,
      batchOptions,
    );
    return;
  }
  await applyRowAloneOnce(ctx, input, supplierCtx, row, totals, batchOptions);
}

async function applyRowAloneWithSyncRetry(
  ctx: SupplierChunkApplyContext,
  input: ImportApplyInput,
  supplierCtx: SupplierApplyContext,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  batchOptions?: ImportApplyBatchOptions,
): Promise<void> {
  for (let attempt = 0; attempt < IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS; attempt++) {
    try {
      await applyRowAloneOnce(
        ctx,
        input,
        supplierCtx,
        row,
        totals,
        batchOptions,
      );
      return;
    } catch (rowError) {
      const handled = await handleSyncRowAloneAttemptFailure(
        ctx,
        input,
        supplierCtx,
        row,
        totals,
        batchOptions,
        rowError,
        attempt,
      );
      if (handled) {
        return;
      }
    }
  }
}

async function handleSyncRowAloneAttemptFailure(
  ctx: SupplierChunkApplyContext,
  input: ImportApplyInput,
  supplierCtx: SupplierApplyContext,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  batchOptions: ImportApplyBatchOptions | undefined,
  error: unknown,
  attempt: number,
): Promise<boolean> {
  if (error instanceof ImportWorkerLeaseLostError) {
    throw error;
  }
  if (isRowLevelApplyError(error)) {
    await markImportRowFailed(
      ctx.prisma,
      input.tenantId,
      supplierCtx.jobId,
      row.row_no,
      toRowApplyError(error),
    );
    totals.error += 1;
    await advanceWorkerCursor(ctx.prisma, input, row, batchOptions);
    return true;
  }
  const kind = classifyImportApplyError(error);
  if (kind === 'retryable' && attempt < IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS - 1) {
    await delayMs(retryableTransactionDelayMs(attempt));
    return false;
  }
  if (kind === 'retryable') {
    throw new ImportApplyRetryExhaustedError(error);
  }
  throw error;
}

async function applyRowAloneOnce(
  ctx: SupplierChunkApplyContext,
  input: ImportApplyInput,
  supplierCtx: SupplierApplyContext,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  batchOptions?: ImportApplyBatchOptions,
): Promise<void> {
  try {
    const result = await ctx.prisma.$transaction(async (tx) => {
      const applied = await applySupplierImportRow(tx, supplierCtx, row);
      await commitWorkerRow(tx, input, row, batchOptions);
      return applied;
    });
    tallyWrittenRow(totals, result.action);
  } catch (rowError) {
    if (rowError instanceof ImportWorkerLeaseLostError) {
      throw rowError;
    }
    if (!isRowLevelApplyError(rowError)) {
      throw rowError;
    }
    await markImportRowFailed(
      ctx.prisma,
      input.tenantId,
      supplierCtx.jobId,
      row.row_no,
      toRowApplyError(rowError),
    );
    totals.error += 1;
    await advanceWorkerCursor(ctx.prisma, input, row, batchOptions);
  }
}

async function applyChunk(
  ctx: SupplierChunkApplyContext,
  input: ImportApplyInput,
  supplierCtx: SupplierApplyContext,
  chunk: ImportApplyRow[],
  offset: number,
  totals: ImportJobTotals,
  batchOptions?: ImportApplyBatchOptions,
): Promise<void> {
  try {
    const counts = await ctx.prisma.$transaction(
      (tx) => applyChunkRows(tx, supplierCtx, chunk, input, batchOptions),
      CHUNK_TRANSACTION_OPTIONS,
    );
    addCounts(totals, counts);
  } catch (chunkError) {
    if (chunkError instanceof ImportWorkerLeaseLostError) {
      throw chunkError;
    }
    ctx.logger.warn(
      `Supplier price list chunk failed at offset ${offset}, falling back to row-by-row: ${describeError(chunkError)}`,
    );
    for (const row of chunk) {
      await applyRowAlone(ctx, input, supplierCtx, row, totals, batchOptions);
    }
  }
}

/**
 * Applies the planned rows in chunks of CHUNK_SIZE rows, one transaction per chunk,
 * until the chunk deadline passes. A failing chunk is applied row by row, so one bad
 * row does not undo its neighbours. Returns whether the deadline stopped the span early.
 */
export async function applySupplierChunks(
  ctx: SupplierChunkApplyContext,
  input: ImportApplyInput,
  supplierCtx: SupplierApplyContext,
  batchRows: ImportApplyRow[],
  totals: ImportJobTotals,
  batchOptions?: ImportApplyBatchOptions,
): Promise<boolean> {
  for (let offset = 0; offset < batchRows.length; offset += CHUNK_SIZE) {
    if (
      batchOptions?.chunkDeadlineMs !== undefined &&
      Date.now() > batchOptions.chunkDeadlineMs
    ) {
      return true;
    }
    await applyChunk(
      ctx,
      input,
      supplierCtx,
      batchRows.slice(offset, offset + CHUNK_SIZE),
      offset,
      totals,
      batchOptions,
    );
  }
  return false;
}
