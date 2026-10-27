import { randomUUID } from 'node:crypto';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';
import {
  IMPORT_ROW_TX_MAX_ATTEMPTS,
  IMPORT_SERIALIZABLE_TX,
} from './import.constants.js';
import {
  delayMs,
  retryableTransactionDelayMs,
} from './import-transaction-retry.util.js';
import { advanceContiguousApplySeqWatermark } from './import-apply-sequence.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
  IMPORT_WORKER_LEASE_MS,
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportJobUploadRef,
  type ImportJobWorkerState,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';
import type { ImportApplyRow } from './import-type-handler.js';
import { assertApplyWorkerLease } from './import-background-apply.commit.js';
import { fillImportJobApplySequences } from './import-apply-sequence-fill.js';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';

export type CreateDryRunJobInput = {
  tenantId: string;
  entityType: ImportEntityType;
  sourceSystem: string;
  fileName?: string;
  fileSha256: string;
  mapping: Record<string, string>;
  options: ImportJobOptions;
  totals: ImportJobTotals;
  actorUserId: string;
  rows: DryRunRowResult[];
};

export function toImportApplyRow(
  row: Prisma.ImportJobRowGetPayload<object>,
): ImportApplyRow {
  return {
    row_no: row.row_no,
    apply_seq: row.apply_seq,
    action: row.action,
    entity_id: row.entity_id,
    external_id: row.external_id,
    normalized_json: row.normalized_json ?? {},
  };
}

function toRowCreate(row: DryRunRowResult) {
  return {
    row_no: row.row_no,
    external_id: row.external_id,
    action: row.action,
    entity_id: row.entity_id,
    errors_json:
      row.errors.length > 0
        ? (row.errors as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    warnings_json:
      row.warnings.length > 0
        ? (row.warnings as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    normalized_json:
      row.normalized === null
        ? Prisma.JsonNull
        : (row.normalized as Prisma.InputJsonValue),
  };
}

/** Reads and writes import jobs and their rows. Every query is scoped to the tenant. */
export class ImportJobStore {
  constructor(private readonly prisma: PrismaService) {}

  findJob(tenantId: string, jobId: string) {
    return this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
  }

  createDryRunJob(input: CreateDryRunJobInput) {
    return this.prisma.importJob.create({
      data: {
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        source_system: input.sourceSystem,
        file_name: input.fileName ?? 'import.csv',
        file_sha256: input.fileSha256,
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping_json: input.mapping,
        options_json: input.options,
        totals_json: input.totals,
        created_by: input.actorUserId,
        rows: { create: input.rows.map(toRowCreate) },
      },
    });
  }

  createPendingBackgroundJob(input: {
    tenantId: string;
    entityType: ImportEntityType;
    sourceSystem: string;
    fileName: string;
    fileSha256: string;
    mapping: Record<string, string>;
    options: ImportJobOptionsWithWorker;
    actorUserId: string;
    upload: ImportJobUploadRef;
    expectedRows: number;
  }) {
    const leaseToken = randomUUID();
    const now = new Date();
    const worker: ImportJobWorkerState = {
      phase: 'dry_run',
      lease_token: leaseToken,
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      started_at: now.toISOString(),
    };
    const totals: ImportJobTotals = {
      rows: input.expectedRows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    return this.prisma.importJob.create({
      data: {
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        source_system: input.sourceSystem,
        file_name: input.fileName,
        file_sha256: input.fileSha256,
        status: ImportJobStatus.APPLYING,
        mapping_json: input.mapping,
        options_json: {
          ...input.options,
          upload: input.upload,
          worker,
        },
        totals_json: totals,
        created_by: input.actorUserId,
      },
    });
  }

  async appendDryRunRows(
    tenantId: string,
    jobId: string,
    rows: DryRunRowResult[],
    totals: ImportJobTotals,
    workerPatch: Partial<ImportJobWorkerState>,
    options: ImportJobOptionsWithWorker,
    leaseToken: string,
  ) {
    const previousProcessed = options.worker?.processed_rows ?? 0;
    const worker = {
      ...options.worker!,
      ...workerPatch,
      lease_until: new Date(0).toISOString(),
    };
    const progressed = (worker.processed_rows ?? 0) > previousProcessed;
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.importJob.updateMany({
        where: {
          tenant_id: tenantId,
          id: jobId,
          status: ImportJobStatus.APPLYING,
          options_json: {
            path: ['worker', 'lease_token'],
            equals: leaseToken,
          },
        },
        data: {},
      });
      if (locked.count === 0) {
        return null;
      }
      return tx.importJob.update({
        where: { tenant_id: tenantId, id: jobId },
        data: {
          totals_json: totals,
          options_json: { ...options, worker },
          worker_handoff_at: new Date(),
          ...(progressed ? { attempts_without_progress: 0 } : {}),
          rows: { create: rows.map(toRowCreate) },
        },
      });
    });
  }

  async cancelBackgroundDryRun(tenantId: string, jobId: string) {
    const job = await this.findJob(tenantId, jobId);
    if (!job || job.status !== ImportJobStatus.APPLYING) {
      return { count: 0 };
    }
    const worker = readWorkerState(
      job.options_json as ImportJobOptionsWithWorker,
    );
    if (!worker || worker.phase !== 'dry_run') {
      return { count: 0 };
    }
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: { status: ImportJobStatus.CANCELLED },
    });
  }

  touchWorkerHandoff(tenantId: string, jobId: string) {
    return this.prisma.importJob.updateMany({
      where: { tenant_id: tenantId, id: jobId },
      data: { worker_handoff_at: new Date() },
    });
  }

  async confirmWorkerRecoveryHandoff(
    tenantId: string,
    jobId: string,
    recoverySeq: number,
  ): Promise<void> {
    await this.prisma.importJob.updateMany({
      where: { tenant_id: tenantId, id: jobId },
      data: {
        worker_recovery_seq: recoverySeq,
        worker_handoff_at: new Date(),
      },
    });
  }

  async releaseWorkerLeaseForHandoff(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const job = await this.findJob(tenantId, jobId);
    if (!job) {
      return false;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (options.worker?.lease_token !== leaseToken) {
      return false;
    }
    const worker = {
      ...options.worker,
      lease_until: new Date(0).toISOString(),
    };
    const updated = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
        options_json: {
          path: ['worker', 'lease_token'],
          equals: leaseToken,
        },
      },
      data: {
        options_json: { ...options, worker },
        worker_handoff_at: new Date(),
      },
    });
    return updated.count > 0;
  }

  async extendWorkerLease(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const job = await this.findJob(tenantId, jobId);
    if (!job) {
      return false;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (options.worker?.lease_token !== leaseToken) {
      return false;
    }
    const leaseUntil = new Date(
      Date.now() + IMPORT_WORKER_LEASE_MS,
    ).toISOString();
    const worker = { ...options.worker, lease_until: leaseUntil };
    const updated = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
        options_json: {
          path: ['worker', 'lease_token'],
          equals: leaseToken,
        },
      },
      data: { options_json: { ...options, worker } },
    });
    return updated.count > 0;
  }

  async claimWorkerLease(
    tenantId: string,
    jobId: string,
    phase: ImportWorkerPhase,
  ): Promise<ImportJobWorkerState | null> {
    for (let attempt = 0; attempt < IMPORT_ROW_TX_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const job = await tx.importJob.findFirst({
            where: {
              tenant_id: tenantId,
              id: jobId,
              status: ImportJobStatus.APPLYING,
            },
          });
          if (!job) {
            return null;
          }
          const options = job.options_json as ImportJobOptionsWithWorker;
          const worker = readWorkerState(options);
          if (!worker || worker.phase !== phase) {
            return null;
          }
          const now = Date.now();
          const leaseUntil = Date.parse(worker.lease_until);
          if (Number.isFinite(leaseUntil) && leaseUntil > now) {
            return null;
          }
          const nextAttempts = job.attempts_without_progress + 1;
          if (nextAttempts >= IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS) {
            await tx.importJob.updateMany({
              where: {
                tenant_id: tenantId,
                id: jobId,
                status: ImportJobStatus.APPLYING,
              },
              data: {
                status: ImportJobStatus.FAILED,
                attempts_without_progress: nextAttempts,
              },
            });
            return null;
          }
          const refreshed: ImportJobWorkerState = {
            ...worker,
            lease_token: randomUUID(),
            lease_until: new Date(now + IMPORT_WORKER_LEASE_MS).toISOString(),
          };
          const locked = await tx.importJob.updateMany({
            where: {
              tenant_id: tenantId,
              id: jobId,
              status: ImportJobStatus.APPLYING,
              options_json: {
                path: ['worker', 'lease_token'],
                equals: worker.lease_token,
              },
            },
            data: {
              options_json: { ...options, worker: refreshed },
              worker_claim_seq: job.worker_claim_seq + 1,
              attempts_without_progress: nextAttempts,
            },
          });
          if (locked.count === 0) {
            return null;
          }
          return refreshed;
        }, IMPORT_SERIALIZABLE_TX);
      } catch (error) {
        if (!isRetryableTransactionError(error)) {
          throw error;
        }
        if (attempt < IMPORT_ROW_TX_MAX_ATTEMPTS - 1) {
          await delayMs(retryableTransactionDelayMs(attempt));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  findRowsPage(
    where: Prisma.ImportJobRowWhereInput,
    skip: number,
    take: number,
  ) {
    return Promise.all([
      this.prisma.importJobRow.findMany({
        where,
        orderBy: { row_no: 'asc' },
        skip,
        take,
      }),
      this.prisma.importJobRow.count({ where }),
    ]);
  }

  findErrorRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        action: ImportRowAction.ERROR,
      },
      orderBy: { row_no: 'asc' },
    });
  }

  findApplyRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: { tenant_id: tenantId, import_job_id: jobId },
      orderBy: { row_no: 'asc' },
    });
  }

  findApplyRowsAfter(
    tenantId: string,
    jobId: string,
    afterRowNo: number,
    take: number,
  ) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { gt: afterRowNo },
      },
      orderBy: { row_no: 'asc' },
      take,
    });
  }

  findApplyRowsAfterApplySeq(
    tenantId: string,
    jobId: string,
    afterApplySeq: number,
    take: number,
  ) {
    return this.prisma.importJobRow
      .findMany({
        where: {
          tenant_id: tenantId,
          import_job_id: jobId,
          apply_seq: { gt: afterApplySeq, not: null },
        },
        orderBy: { apply_seq: 'asc' },
        take,
      })
      .then((rows) => rows.map(toImportApplyRow));
  }

  async maxApplySeq(tenantId: string, jobId: string): Promise<number> {
    const row = await this.prisma.importJobRow.findFirst({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        apply_seq: { not: null },
      },
      orderBy: { apply_seq: 'desc' },
      select: { apply_seq: true },
    });
    return row?.apply_seq ?? 0;
  }

  countApplyRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.count({
      where: { tenant_id: tenantId, import_job_id: jobId },
    });
  }

  markFailedIfApplying(
    tenantId: string,
    jobId: string,
    totals?: ImportJobTotals,
  ) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.FAILED,
        ...(totals ? { totals_json: totals } : {}),
      },
    });
  }

  finishDryRunIfStillApplying(
    tenantId: string,
    jobId: string,
    data: {
      totals_json: ImportJobTotals;
      options_json: ImportJobOptions;
    },
  ) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.DRY_RUN_DONE,
        totals_json: data.totals_json,
        options_json: data.options_json,
      },
    });
  }

  /** Moves a dry-run job to APPLYING. The status guard makes concurrent applies fail. */
  lockForApply(tenantId: string, jobId: string) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: {
          in: [ImportJobStatus.DRY_RUN_DONE, ImportJobStatus.FAILED],
        },
      },
      data: { status: ImportJobStatus.APPLYING },
    });
  }

  async lockForBackgroundApply(
    tenantId: string,
    jobId: string,
    options: ImportJobOptionsWithWorker,
    dryRunTotals: ImportJobTotals,
    applySequenceOrderKey: ImportApplySequenceOrderKey,
  ) {
    const applyTotals: ImportJobTotals = {
      rows: dryRunTotals.rows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    const leaseToken = randomUUID();
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: leaseToken,
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.importJob.updateMany({
          where: {
            tenant_id: tenantId,
            id: jobId,
            status: {
              in: [ImportJobStatus.DRY_RUN_DONE, ImportJobStatus.FAILED],
            },
          },
          data: {
            status: ImportJobStatus.APPLYING,
            totals_json: applyTotals,
            options_json: { ...options, worker },
            attempts_without_progress: 0,
          },
        });
        if (lock.count === 0) {
          return lock;
        }
        await fillImportJobApplySequences(
          tx,
          tenantId,
          jobId,
          applySequenceOrderKey,
        );
        if (dryRunTotals.rows === 0) {
          await tx.importJob.updateMany({
            where: {
              tenant_id: tenantId,
              id: jobId,
              status: ImportJobStatus.APPLYING,
            },
            data: {
              status: ImportJobStatus.APPLIED,
              appliedAt: new Date(),
            },
          });
        }
        return lock;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}

/** Records a row that failed during apply, with the code and message shown on the row. */
export async function commitApplyWorkerRowInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
  applySeq: number,
): Promise<void> {
  await assertApplyWorkerLease(tx, tenantId, jobId, leaseToken);
  const job = await tx.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const workerState = options.worker;
  if (!workerState) {
    throw new ImportWorkerLeaseLostError();
  }
  const applyWatermark = advanceContiguousApplySeqWatermark(
    workerState.last_committed_apply_seq ?? 0,
    applySeq,
  );
  const worker: ImportJobWorkerState = {
    ...workerState,
    last_committed_apply_seq: applyWatermark,
    processed_rows: applyWatermark,
  };
  await tx.importJob.update({
    where: { id: jobId },
    data: { options_json: { ...options, worker } },
  });
}

/** Records a row that failed during apply, with the code and message shown on the row. */
export function markImportRowFailed(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  rowNo: number,
  error: { code: string; message: string },
) {
  return prisma.importJobRow.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: rowNo,
      },
    },
    data: {
      action: ImportRowAction.ERROR,
      errors_json: [error],
    },
  });
}
