import { Logger } from '@nestjs/common';
import {
  ImportEntityType,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyImportApplyError,
  coerceWriteRowToDomainError,
  describeImportApplyCause,
  ImportDuplicateCreateInJobError,
  toRowApplyError,
} from './import-apply.errors.js';
import {
  isCreateAlreadyCommittedByJob,
  isDuplicateCreateAfterAnotherRowCommitted,
} from './import-apply-duplicate-create.js';
import { assertApplyRowIsFresh } from './import-apply.freshness.js';
import { applySeqForRow } from './import-apply-sequence.js';
import {
  assertApplyWorkerLease,
  commitBackgroundApplyRowInTransaction,
} from './import-background-apply.commit.js';
import { IMPORT_LOGGER_CONTEXT, IMPORT_ROW_TX_MAX_ATTEMPTS, IMPORT_SERIALIZABLE_TX } from './import.constants.js';
import {
  delayMs,
  retryableTransactionDelayMs,
} from './import-transaction-retry.util.js';
import { importTotalsAfterApplyRowTally } from './import-totals.util.js';
import type { ImportApplyRowTally } from './import-totals.util.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  ImportApplyRow,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';
import type { ImportRowWriter } from './import-row-apply.legacy-row.js';

export type SequenceApplyRowContext = {
  logger: Logger;
  prisma: PrismaService;
};

/**
 * Background apply path: the row, its freshness check and the worker cursor advance
 * commit in one serializable transaction guarded by the lease. A row-level failure is
 * written as an ERROR row and still advances the cursor; contention retries up to the
 * worker cap and then surfaces to the caller.
 */
export async function applyOneWithSequence(
  ctx: SequenceApplyRowContext,
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
      const { nextTotals } = await commitImportSequenceRow(
        ctx,
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
      const outcome = sequenceRowAttemptOutcome(error, attempt);
      if (outcome === 'retry') {
        await delayMs(retryableTransactionDelayMs(attempt));
        continue;
      }
      if (outcome === 'rethrow') {
        throw error;
      }
      const nextTotals = await markImportSequenceRowFailed(
        ctx,
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

function sequenceRowAttemptOutcome(
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

async function commitImportSequenceRow(
  ctx: SequenceApplyRowContext,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  writeRow: ImportRowWriter,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  leaseToken: string,
  applySeq: number,
  maxApplySeq: number,
): Promise<{ nextTotals: ImportJobTotals }> {
  return ctx.prisma.$transaction(async (tx) => {
    await assertApplyWorkerLease(tx, input.tenantId, input.job.id, leaseToken);
    const rowTally = await applyRowBodyInTransaction(
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
      rowNo: row.row_no,
    });
    return { nextTotals };
  }, IMPORT_SERIALIZABLE_TX);
}

async function markImportSequenceRowFailed(
  ctx: SequenceApplyRowContext,
  input: ImportApplyInput,
  row: ImportApplyRow,
  totals: ImportJobTotals,
  leaseToken: string,
  applySeq: number,
  maxApplySeq: number,
  error: unknown,
): Promise<ImportJobTotals> {
  ctx.logger.warn(
    `Import apply row failed jobId=${input.job.id} rowNo=${row.row_no} cause=${describeImportApplyCause(error)}`,
  );
  const nextTotals = importTotalsAfterApplyRowTally(totals, row.action, 'error');
  await ctx.prisma.$transaction(async (tx) => {
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
      rowNo: row.row_no,
    });
  }, IMPORT_SERIALIZABLE_TX);
  return nextTotals;
}

async function applyRowBodyInTransaction(
  tx: Prisma.TransactionClient,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  writeRow: ImportRowWriter,
  row: ImportApplyRow,
): Promise<'error' | 'skip' | 'noop' | 'written'> {
  if (row.action === ImportRowAction.ERROR) {
    return 'error';
  }
  if (row.action === ImportRowAction.SKIP) {
    return 'skip';
  }
  if (
    row.action === ImportRowAction.CREATE &&
    (await isCreateAlreadyCommittedByJob(tx, input, entityType, row))
  ) {
    if (await isDuplicateCreateAfterAnotherRowCommitted(tx, input, row)) {
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
