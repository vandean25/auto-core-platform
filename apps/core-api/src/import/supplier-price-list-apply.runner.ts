import { Logger } from '@nestjs/common';
import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  isRowLevelApplyError,
  toRowApplyError,
} from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { markImportRowFailed } from './import-job.store.js';
import type {
  SerializedImportJob,
  SerializeImportJobFn,
} from './import-job.serializer.js';
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import { createApplyTotals, tallyWrittenRow } from './import-totals.util.js';
import type {
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
    const { tenantId, job, rows } = input;
    const totals = createApplyTotals(rows.length);
    const ctx: SupplierApplyContext = {
      tenantId,
      vendorId: vendor.id,
      jobId: job.id,
      sourceSystem: job.source_system,
    };

    // Set only after the APPLIED transition has committed. A later failure must not
    // overwrite an applied job with FAILED.
    let jobApplied = false;
    try {
      for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
        await this.applyChunk(
          input,
          ctx,
          rows.slice(offset, offset + CHUNK_SIZE),
          offset,
          totals,
        );
      }

      const updatedJob = await this.markApplied(input, totals);
      jobApplied = true;
      return this.serialize(updatedJob, totals);
    } catch (error) {
      if (!jobApplied) {
        await this.markFailed(job.id, totals);
      }
      throw error;
    }
  }

  private async applyChunk(
    input: ImportApplyInput,
    ctx: SupplierApplyContext,
    chunk: ImportApplyRow[],
    offset: number,
    totals: ImportJobTotals,
  ): Promise<void> {
    try {
      // Counts stay local to the transaction and are merged only after it commits, so a
      // rolled-back chunk contributes nothing.
      const counts = await this.prisma.$transaction(
        (tx) => this.applyChunkRows(tx, ctx, chunk),
        CHUNK_TRANSACTION_OPTIONS,
      );
      addCounts(totals, counts);
    } catch (chunkError) {
      this.logger.warn(
        `Supplier price list chunk failed at offset ${offset}, falling back to row-by-row: ${describeError(chunkError)}`,
      );
      for (const row of chunk) {
        await this.applyRowAlone(input, ctx, row, totals);
      }
    }
  }

  private async applyChunkRows(
    tx: Prisma.TransactionClient,
    ctx: SupplierApplyContext,
    chunk: ImportApplyRow[],
  ): Promise<ImportJobTotals> {
    const counts = createApplyTotals(0);
    for (const row of chunk) {
      if (row.action === ImportRowAction.ERROR) {
        counts.error += 1;
      } else if (row.action === ImportRowAction.SKIP) {
        counts.skip += 1;
      } else {
        const result = await applySupplierImportRow(tx, ctx, row);
        tallyWrittenRow(counts, result.action);
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
  ): Promise<void> {
    if (row.action === ImportRowAction.ERROR) {
      totals.error += 1;
      return;
    }
    if (row.action === ImportRowAction.SKIP) {
      totals.skip += 1;
      return;
    }

    try {
      const result = await this.prisma.$transaction((tx) =>
        applySupplierImportRow(tx, ctx, row),
      );
      tallyWrittenRow(totals, result.action);
    } catch (rowError) {
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
    }
  }

  /** The APPLIED transition and its audit entry commit together or not at all. */
  private markApplied(input: ImportApplyInput, totals: ImportJobTotals) {
    const { tenantId, job, actorUserId, effectiveOptions } = input;
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
