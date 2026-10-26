import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { toRowApplyError } from './import-apply.errors.js';
import { assertApplyRowIsFresh } from './import-apply.freshness.js';
import { resolveImportExternalId } from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import {
  commitApplyWorkerRowInTransaction,
  markImportRowFailed,
} from './import-job.store.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import { planImportApplyBatch } from './import-apply-batch.plan.js';
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import type {
  SerializedImportJob,
  SerializeImportJobFn,
} from './import-job.serializer.js';
import {
  createApplyTotals,
  createResumedApplyTotals,
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

/**
 * Applies a job one row at a time, each row in its own transaction. Any row failure, whatever
 * its cause, becomes an ERROR row. A failure outside the rows marks the job FAILED and is
 * rethrown. Customer and vehicle imports use this runner.
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
      if (options?.deferWorkerCursorCommits && options.leaseToken) {
        await this.commitWorkerBatchHighWater(input, plan.batchRows, options);
      }
      return await this.finishApplyRun(
        input,
        totals,
        guardedWrite,
        plan.batchIncomplete,
      );
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        throw error;
      }
      await this.markJobFailed(job.id, totals, guardedWrite);
      throw error;
    }
  }

  private async finishApplyRun(
    input: ImportApplyInput,
    totals: ImportJobTotals,
    guardedWrite: boolean,
    batchIncomplete: boolean,
  ): Promise<SerializedImportJob> {
    const { tenantId, job, actorUserId } = input;
    if (batchIncomplete) {
      const partialJob = await this.persistApplyingTotals(
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
          resumeAfterRowNo: resumeAfter,
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

  private async persistApplyingTotals(
    jobId: string,
    totals: ImportJobTotals,
    guardedWrite: boolean,
  ) {
    if (guardedWrite) {
      await this.prisma.importJob.updateMany({
        where: { id: jobId, status: ImportJobStatus.APPLYING },
        data: { totals_json: totals },
      });
      return this.prisma.importJob.findFirst({ where: { id: jobId } });
    }
    return this.prisma.importJob.update({
      where: { id: jobId },
      data: { totals_json: totals, status: ImportJobStatus.APPLYING },
    });
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

  private async commitWorkerBatchHighWater(
    input: ImportApplyInput,
    batchRows: ImportApplyRow[],
    options: ImportApplyBatchOptions,
  ): Promise<void> {
    const leaseToken = options.leaseToken;
    if (batchRows.length === 0 || !leaseToken) {
      return;
    }
    const highWater = Math.max(...batchRows.map((row) => row.row_no));
    await this.prisma.$transaction(async (tx) => {
      await commitApplyWorkerRowInTransaction(
        tx,
        input.tenantId,
        input.job.id,
        leaseToken,
        highWater,
      );
    });
  }

  private async advanceWorkerCursor(
    input: ImportApplyInput,
    rowNo: number,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    if (options?.deferWorkerCursorCommits) {
      return;
    }
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
        rowNo,
      );
    });
  }

  private async applyOne(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options?: ImportApplyBatchOptions,
  ): Promise<void> {
    if (row.action === ImportRowAction.ERROR) {
      totals.error += 1;
      await this.advanceWorkerCursor(input, row.row_no, options);
      return;
    }
    if (row.action === ImportRowAction.SKIP) {
      totals.skip += 1;
      await this.advanceWorkerCursor(input, row.row_no, options);
      return;
    }

    try {
      if (
        row.action === ImportRowAction.CREATE &&
        (await this.isCreateAlreadyCommittedByJob(input, entityType, row))
      ) {
        await this.advanceWorkerCursor(input, row.row_no, options);
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
        } else if (options?.leaseToken && !options.deferWorkerCursorCommits) {
          await commitApplyWorkerRowInTransaction(
            tx,
            input.tenantId,
            input.job.id,
            options.leaseToken,
            row.row_no,
          );
        }
      });
      tallyWrittenRow(totals, row.action);
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
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
      await this.advanceWorkerCursor(input, row.row_no, options);
    }
  }
}
