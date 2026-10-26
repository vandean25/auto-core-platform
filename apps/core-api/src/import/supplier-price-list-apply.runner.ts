import { Logger } from '@nestjs/common';
import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  isRowLevelApplyError,
  toRowApplyError,
} from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { persistImportJobApplyingTotals } from './import-job.guarded-persist.util.js';
import {
  commitApplyWorkerRowInTransaction,
  markImportRowFailed,
} from './import-job.store.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import type {
  ImportJobView,
  SerializedImportJob,
  SerializeImportJobFn,
} from './import-job.serializer.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import {
  createApplyTotals,
  createResumedApplyTotals,
  tallyWrittenRow,
} from './import-totals.util.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  ImportApplyRow,
  VendorRef,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';
import {
  applySupplierImportRow,
  type SupplierApplyContext,
} from './supplier-price-list-import.apply.js';

/** Rows per transaction. A failing chunk is retried row by row. */
const CHUNK_SIZE = 50;
const CHUNK_TRANSACTION_OPTIONS = { timeout: 30000, maxWait: 10000 };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addCounts(totals: ImportJobTotals, counts: ImportJobTotals): void {
  totals.create += counts.create;
  totals.update += counts.update;
  totals.skip += counts.skip;
  totals.error += counts.error;
}

/**
 * Applies a supplier price list in chunks of rows, one transaction per chunk. A failing chunk
 * is applied row by row, so one bad row does not undo its neighbours. A failure outside the
 * rows marks the job FAILED, unless the job was already applied.
 */
export class SupplierChunkedApplyRunner {
  private readonly logger = new Logger(IMPORT_LOGGER_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditWriter,
    private readonly serialize: SerializeImportJobFn,
  ) {}

  async run(
    input: ImportApplyInput,
    vendor: VendorRef,
  ): Promise<SerializedImportJob> {
    const batchOptions = input.batchOptions;
    const plan = planImportApplyBatch(input.rows, batchOptions);
    const totals = this.buildTotals(input, batchOptions);
    const guardedWrite = Boolean(batchOptions?.stopAfterBatch);
    const ctx = this.buildContext(input, vendor);
    let jobApplied = false;
    try {
      await this.applyPlannedChunks(
        input,
        ctx,
        plan.batchRows,
        totals,
        batchOptions,
      );
      const finishedJob = await this.finishApplyRun(
        input,
        totals,
        guardedWrite,
        plan.batchIncomplete,
      );
      jobApplied = finishedJob.applied;
      return this.serialize(finishedJob.job, totals);
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        throw error;
      }
      if (!jobApplied) {
        await this.markFailed(input.job.id, totals);
      }
      throw error;
    }
  }

  private buildTotals(
    input: ImportApplyInput,
    batchOptions?: ImportApplyBatchOptions,
  ): ImportJobTotals {
    const storedTotals = input.job.totals_json as ImportJobTotals | null;
    if (batchOptions?.stopAfterBatch && storedTotals) {
      return createResumedApplyTotals(input.rows.length, storedTotals);
    }
    return createApplyTotals(
      Math.max(input.rows.length, storedTotals?.rows ?? 0),
    );
  }

  private buildContext(
    input: ImportApplyInput,
    vendor: VendorRef,
  ): SupplierApplyContext {
    return {
      tenantId: input.tenantId,
      vendorId: vendor.id,
      jobId: input.job.id,
      sourceSystem: input.job.source_system,
    };
  }

  private async applyPlannedChunks(
    input: ImportApplyInput,
    ctx: SupplierApplyContext,
    batchRows: ImportApplyRow[],
    totals: ImportJobTotals,
    batchOptions?: ImportApplyBatchOptions,
  ): Promise<void> {
    for (let offset = 0; offset < batchRows.length; offset += CHUNK_SIZE) {
      await this.applyChunk(
        input,
        ctx,
        batchRows.slice(offset, offset + CHUNK_SIZE),
        offset,
        totals,
        batchOptions,
      );
    }
  }

  private async finishApplyRun(
    input: ImportApplyInput,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    batchIncomplete: boolean,
  ): Promise<{ job: ImportJobView; applied: boolean }> {
    if (batchIncomplete) {
      const partialJob = await persistImportJobApplyingTotals(
        this.prisma,
        input.job.id,
        totals,
        guardedWrite,
      );
      return { job: partialJob as ImportJobView, applied: false };
    }
    const updatedJob = await this.markApplied(input, totals, guardedWrite);
    return { job: updatedJob, applied: true };
  }

  private async applyChunk(
    input: ImportApplyInput,
    ctx: SupplierApplyContext,
    chunk: ImportApplyRow[],
    offset: number,
    totals: ImportJobTotals,
    batchOptions?: ImportApplyBatchOptions,
  ): Promise<void> {
    try {
      const counts = await this.prisma.$transaction(
        (tx) => this.applyChunkRows(tx, ctx, chunk, input, batchOptions),
        CHUNK_TRANSACTION_OPTIONS,
      );
      addCounts(totals, counts);
    } catch (chunkError) {
      if (chunkError instanceof ImportWorkerLeaseLostError) {
        throw chunkError;
      }
      this.logger.warn(
        `Supplier price list chunk failed at offset ${offset}, falling back to row-by-row: ${describeError(chunkError)}`,
      );
      for (const row of chunk) {
        await this.applyRowAlone(input, ctx, row, totals, batchOptions);
      }
    }
  }

  private async commitWorkerRow(
    tx: Prisma.TransactionClient,
    input: ImportApplyInput,
    rowNo: number,
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
      rowNo,
    );
  }

  private async advanceWorkerCursor(
    input: ImportApplyInput,
    rowNo: number,
    batchOptions?: ImportApplyBatchOptions,
  ): Promise<void> {
    if (!batchOptions?.leaseToken) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.commitWorkerRow(tx, input, rowNo, batchOptions);
    });
  }

  private async applyChunkRows(
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
        await this.commitWorkerRow(tx, input, row.row_no, batchOptions);
      } else if (row.action === ImportRowAction.SKIP) {
        counts.skip += 1;
        await this.commitWorkerRow(tx, input, row.row_no, batchOptions);
      } else {
        const result = await applySupplierImportRow(tx, ctx, row);
        tallyWrittenRow(counts, result.action);
        await this.commitWorkerRow(tx, input, row.row_no, batchOptions);
      }
    }
    return counts;
  }

  /** Fallback for one row after its chunk failed. Only row-level failures are kept as ERROR. */
  private async applyRowAlone(
    input: ImportApplyInput,
    ctx: SupplierApplyContext,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    batchOptions?: ImportApplyBatchOptions,
  ): Promise<void> {
    if (row.action === ImportRowAction.ERROR) {
      totals.error += 1;
      await this.advanceWorkerCursor(input, row.row_no, batchOptions);
      return;
    }
    if (row.action === ImportRowAction.SKIP) {
      totals.skip += 1;
      await this.advanceWorkerCursor(input, row.row_no, batchOptions);
      return;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const applied = await applySupplierImportRow(tx, ctx, row);
        await this.commitWorkerRow(tx, input, row.row_no, batchOptions);
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
        this.prisma,
        input.tenantId,
        ctx.jobId,
        row.row_no,
        toRowApplyError(rowError),
      );
      totals.error += 1;
      await this.advanceWorkerCursor(input, row.row_no, batchOptions);
    }
  }

  /** The APPLIED transition and its audit entry commit together or not at all. */
  private async markApplied(
    input: ImportApplyInput,
    totals: ImportJobTotals,
    guardedWrite: boolean,
  ) {
    const { tenantId, job, actorUserId, effectiveOptions } = input;
    if (guardedWrite) {
      await this.prisma.importJob.updateMany({
        where: { id: job.id, status: ImportJobStatus.APPLYING },
        data: {
          status: ImportJobStatus.APPLIED,
          appliedAt: new Date(),
          totals_json: totals,
          options_json: effectiveOptions,
        },
      });
      const updatedJob = await this.prisma.importJob.findFirst({
        where: { id: job.id },
      });
      await this.audit.writeImportJobAudit(
        this.prisma,
        tenantId,
        actorUserId,
        job.id,
        'applied',
        totals,
      );
      return updatedJob!;
    }
    return this.prisma.$transaction(async (tx) => {
      const applied = await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: ImportJobStatus.APPLIED,
          appliedAt: new Date(),
          totals_json: totals,
          options_json: effectiveOptions,
        },
      });
      await this.audit.writeImportJobAudit(
        tx,
        tenantId,
        actorUserId,
        job.id,
        'applied',
        totals,
      );
      return applied;
    });
  }

  /**
   * Chunks that already committed stay applied. The job ends FAILED with the totals of that
   * committed work. The status guard keeps this from overwriting an applied job.
   */
  private async markFailed(
    jobId: string,
    totals: ImportJobTotals,
  ): Promise<void> {
    try {
      await this.prisma.importJob.updateMany({
        where: { id: jobId, status: ImportJobStatus.APPLYING },
        data: { status: ImportJobStatus.FAILED, totals_json: totals },
      });
    } catch (markError) {
      this.logger.error(
        `Could not mark import job ${jobId} as FAILED: ${describeError(markError)}`,
      );
    }
  }
}
