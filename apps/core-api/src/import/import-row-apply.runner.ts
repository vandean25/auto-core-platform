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
import {
  IMPORT_APPLY_BATCH_SIZE,
  IMPORT_LOGGER_CONTEXT,
} from './import.constants.js';
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
    options?: { resumeAfterRowNo?: number; stopAfterBatch?: boolean },
  ): Promise<SerializedImportJob> {
    const { tenantId, job, rows, actorUserId } = input;
    const storedTotals = job.totals_json as ImportJobTotals | null;
    const totals =
      options?.stopAfterBatch && storedTotals
        ? createResumedApplyTotals(rows.length, storedTotals)
        : createApplyTotals(Math.max(rows.length, storedTotals?.rows ?? 0));
    const plan = this.planApplyBatch(rows, options);
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

      if (plan.batchIncomplete) {
        const partialJob = await this.persistApplyingTotals(
          job.id,
          totals,
          guardedWrite,
        );
        return this.serialize(partialJob!, totals);
      }

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
    } catch (error) {
      await this.markJobFailed(job.id, totals, guardedWrite);
      throw error;
    }
  }

  private planApplyBatch(
    rows: ImportApplyRow[],
    options?: { resumeAfterRowNo?: number; stopAfterBatch?: boolean },
  ) {
    const resumeAfter = options?.resumeAfterRowNo ?? 0;
    const pending = rows.filter((row) => row.row_no > resumeAfter);
    const batchSize = options?.stopAfterBatch
      ? IMPORT_APPLY_BATCH_SIZE
      : pending.length;
    const batchRows = pending.slice(0, batchSize);
    const batchIncomplete =
      Boolean(options?.stopAfterBatch) && pending.length > batchRows.length;
    return { resumeAfter, batchRows, batchIncomplete };
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

  private async applyOne(
    input: ImportApplyInput,
    entityType: ImportEntityType,
    writeRow: ImportRowWriter,
    row: ImportApplyRow,
    totals: ImportJobTotals,
    options?: {
      resumeAfterRowNo?: number;
      stopAfterBatch?: boolean;
      leaseToken?: string;
      onRowCommitted?: (
        tx: Prisma.TransactionClient,
        rowNo: number,
      ) => Promise<void>;
    },
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
      if (
        row.action === ImportRowAction.CREATE &&
        (await this.isCreateAlreadyCommittedByJob(input, entityType, row))
      ) {
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
            row.row_no,
          );
        }
      });
      tallyWrittenRow(totals, row.action);
    } catch (error) {
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
    }
  }
}
