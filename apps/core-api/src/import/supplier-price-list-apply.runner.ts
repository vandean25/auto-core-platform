import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyImportApplyError,
  describeImportApplyCause,
  ImportApplyRetryExhaustedError,
  type ImportApplyFailureReason,
} from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { persistImportJobApplyingTotals } from './import-job.guarded-persist.util.js';
import type {
  ImportJobView,
  SerializedImportJob,
  SerializeImportJobFn,
} from './import-job.serializer.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import {
  isImportSyncLegacyApplyPath,
  withImportSyncApplyIoRetry,
} from './import-transaction-retry.util.js';
import {
  createApplyTotals,
  createResumedApplyTotals,
} from './import-totals.util.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  VendorRef,
} from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';
import type { SupplierApplyContext } from './supplier-price-list-import.apply.js';
import { applySupplierChunks } from './supplier-price-list-apply.chunks.js';
import {
  markSupplierJobApplied,
  markSupplierJobFailed,
  type SupplierJobStateContext,
} from './supplier-price-list-apply.job-state.js';

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
    const supplierCtx = this.buildContext(input, vendor);
    const ctx: SupplierJobStateContext = {
      logger: this.logger,
      prisma: this.prisma,
      audit: this.audit,
    };
    let jobApplied = false;
    try {
      const stoppedEarly = await applySupplierChunks(
        ctx,
        input,
        supplierCtx,
        plan.batchRows,
        totals,
        batchOptions,
      );
      const finishedJob = await this.finishApplyRun(
        ctx,
        input,
        totals,
        guardedWrite,
        plan.batchIncomplete || stoppedEarly,
        batchOptions,
      );
      jobApplied = finishedJob.applied;
      const appliedTotals =
        (finishedJob.job.totals_json as ImportJobTotals) ?? totals;
      return this.serialize(finishedJob.job, appliedTotals);
    } catch (error) {
      const kind = classifyImportApplyError(error);
      if (kind === 'lease_lost' || kind === 'retryable') {
        throw error;
      }
      const failureReason: ImportApplyFailureReason =
        error instanceof ImportApplyRetryExhaustedError
          ? 'retry_exhausted'
          : 'apply_error';
      if (!jobApplied) {
        await markSupplierJobFailed(ctx, {
          jobId: input.job.id,
          totals,
          failureReason,
          cause: describeImportApplyCause(error),
          batchOptions,
        });
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

  private async finishApplyRun(
    ctx: SupplierJobStateContext,
    input: ImportApplyInput,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    batchIncomplete: boolean,
    batchOptions?: ImportApplyBatchOptions,
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
    const syncPath = isImportSyncLegacyApplyPath(batchOptions);
    const updatedJob = await withImportSyncApplyIoRetry(syncPath, () =>
      markSupplierJobApplied(ctx, input, { totals, guardedWrite }),
    );
    return { job: updatedJob, applied: true };
  }
}
