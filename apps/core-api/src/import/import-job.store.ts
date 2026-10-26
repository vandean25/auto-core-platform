import { randomUUID } from 'node:crypto';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
  IMPORT_WORKER_LEASE_MS,
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportJobUploadRef,
  type ImportJobWorkerState,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
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
  ) {
    const worker = { ...options.worker!, ...workerPatch };
    const locked = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {},
    });
    if (locked.count === 0) {
      return null;
    }
    return this.prisma.importJob.update({
      where: { tenant_id: tenantId, id: jobId },
      data: {
        totals_json: totals,
        options_json: { ...options, worker },
        rows: { create: rows.map(toRowCreate) },
      },
    });
  }

  async updateWorkerProgress(
    tenantId: string,
    jobId: string,
    leaseToken: string,
    patch: Partial<ImportJobWorkerState> & {
      totals?: ImportJobTotals;
      status?: ImportJobStatus;
    },
  ) {
    const job = await this.findJob(tenantId, jobId);
    if (!job) {
      return null;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (options.worker?.lease_token !== leaseToken) {
      return null;
    }
    const worker = { ...options.worker, ...patch };
    const locked = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        ...(patch.totals ? { totals_json: patch.totals } : {}),
        options_json: { ...options, worker },
      },
    });
    if (locked.count === 0) {
      return null;
    }
    if (patch.status && patch.status !== ImportJobStatus.APPLYING) {
      return this.prisma.importJob.update({
        where: { tenant_id: tenantId, id: jobId },
        data: {
          status: patch.status,
          ...(patch.status === ImportJobStatus.APPLIED
            ? { appliedAt: new Date() }
            : {}),
        },
      });
    }
    return this.findJob(tenantId, jobId);
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

  async claimWorkerLease(
    tenantId: string,
    jobId: string,
    phase: ImportWorkerPhase,
  ): Promise<ImportJobWorkerState | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
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
            },
          });
          if (locked.count === 0) {
            return null;
          }
          return refreshed;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        return null;
      }
      throw error;
    }
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
        status: ImportJobStatus.DRY_RUN_DONE,
      },
      data: { status: ImportJobStatus.APPLYING },
    });
  }

  async lockForBackgroundApply(
    tenantId: string,
    jobId: string,
    options: ImportJobOptionsWithWorker,
    dryRunTotals: ImportJobTotals,
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
      last_committed_row_no: 0,
      started_at: new Date().toISOString(),
    };
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.DRY_RUN_DONE,
      },
      data: {
        status: ImportJobStatus.APPLYING,
        totals_json: applyTotals,
        options_json: { ...options, worker },
      },
    });
  }
}

/** Records a row that failed during apply, with the code and message shown on the row. */
export async function commitApplyWorkerRowInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
  rowNo: number,
): Promise<void> {
  const job = await tx.importJob.findFirst({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  if (options.worker?.lease_token !== leaseToken) {
    throw new ImportWorkerLeaseLostError();
  }
  const previous = options.worker.last_committed_row_no ?? 0;
  const highWater = Math.max(previous, rowNo);
  const worker: ImportJobWorkerState = {
    ...options.worker,
    last_committed_row_no: highWater,
    processed_rows: highWater,
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
