import { randomUUID } from 'node:crypto';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { planTechnicalRetry } from './import-technical-retry.js';
import type {
  ImportApplyFailureReason,
  ImportJobFailureDetail,
} from './import-apply.errors.js';
import { importJobOptionsWithFailure } from './import-apply-failure.util.js';
import {
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportJobUploadRef,
  type ImportJobWorkerState,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import type { ImportApplyRow } from './import-type-handler.js';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';
import {
  toRowCreate,
  appendDryRunRows as appendDryRunRowsTx,
  beginBackgroundDryRunReconcile as beginBackgroundDryRunReconcileTx,
  finalizeBackgroundDryRunReconcile as finalizeBackgroundDryRunReconcileTx,
  persistDryRunReconcileChunk as persistDryRunReconcileChunkTx,
} from './import-job.store.dry-run-persist.js';
import {
  claimWorkerLease as claimWorkerLeaseTx,
  confirmWorkerRecoveryHandoff as confirmWorkerRecoveryHandoffTx,
  extendWorkerLease as extendWorkerLeaseTx,
  releaseWorkerLeaseForHandoff as releaseWorkerLeaseForHandoffTx,
  releaseWorkerLeaseForRetry as releaseWorkerLeaseForRetryTx,
  touchWorkerHandoff as touchWorkerHandoffTx,
} from './import-job.store.worker-lease.js';
import {
  lockForApply as lockForApplyTx,
  lockForBackgroundApply as lockForBackgroundApplyTx,
} from './import-job.store.apply-lock.js';

export type CreateDryRunJobInput = {
  tenantId: string;
  jobId?: string;
  entityType: ImportEntityType;
  sourceSystem: string;
  fileName?: string;
  fileSha256: string;
  mapping: Record<string, string>;
  options: ImportJobOptionsWithWorker;
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

/** Reads and writes import jobs and their rows. Every query is scoped to the tenant. */
export class ImportJobStore {
  constructor(private readonly prisma: PrismaService) {}

  findJob(tenantId: string, jobId: string) {
    return this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
  }

  /** Lists a tenant's import jobs newest-first (uses the tenant/createdAt index). */
  findJobsPage(where: Prisma.ImportJobWhereInput, skip: number, take: number) {
    return Promise.all([
      this.prisma.importJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.importJob.count({ where }),
    ]);
  }

  createDryRunJob(input: CreateDryRunJobInput) {
    return this.prisma.importJob.create({
      data: {
        ...(input.jobId ? { id: input.jobId } : {}),
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
    /** Lets callers place the upload object under a path that names this job. */
    jobId?: string;
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
        ...(input.jobId ? { id: input.jobId } : {}),
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

  appendDryRunRows(
    tenantId: string,
    jobId: string,
    rows: DryRunRowResult[],
    totals: ImportJobTotals,
    workerPatch: Partial<ImportJobWorkerState>,
    options: ImportJobOptionsWithWorker,
    leaseToken: string,
  ) {
    return appendDryRunRowsTx(
      this.prisma,
      tenantId,
      jobId,
      rows,
      totals,
      workerPatch,
      options,
      leaseToken,
    );
  }

  beginBackgroundDryRunReconcile(
    tenantId: string,
    jobId: string,
    units: ImportJobWorkerState['dry_run_reconcile_units'],
    options: ImportJobOptionsWithWorker,
    leaseToken: string,
  ) {
    return beginBackgroundDryRunReconcileTx(
      this.prisma,
      tenantId,
      jobId,
      units,
      options,
      leaseToken,
    );
  }

  finalizeBackgroundDryRunReconcile(
    tenantId: string,
    jobId: string,
    leaseToken: string,
    expectedRows: number,
    options: ImportJobOptionsWithWorker,
  ): Promise<{ totals: ImportJobTotals } | null> {
    return finalizeBackgroundDryRunReconcileTx(
      this.prisma,
      tenantId,
      jobId,
      leaseToken,
      expectedRows,
      options,
    );
  }

  persistDryRunReconcileChunk(
    tenantId: string,
    jobId: string,
    rows: DryRunRowResult[],
    workerPatch: Partial<ImportJobWorkerState>,
    options: ImportJobOptionsWithWorker,
    leaseToken: string,
    finalize?: {
      expectedRows: number;
      optionsForPersist: ImportJobOptions;
    },
  ) {
    return persistDryRunReconcileChunkTx(
      this.prisma,
      tenantId,
      jobId,
      rows,
      workerPatch,
      options,
      leaseToken,
      finalize,
    );
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
      data: {
        status: ImportJobStatus.CANCELLED,
        cancelled_at: new Date(),
      },
    });
  }

  releaseWorkerLeaseForRetry(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    return releaseWorkerLeaseForRetryTx(
      this.prisma,
      tenantId,
      jobId,
      leaseToken,
    );
  }

  touchWorkerHandoff(tenantId: string, jobId: string) {
    return touchWorkerHandoffTx(this.prisma, tenantId, jobId);
  }

  confirmWorkerRecoveryHandoff(
    tenantId: string,
    jobId: string,
    recoverySeq: number,
  ): Promise<void> {
    return confirmWorkerRecoveryHandoffTx(
      this.prisma,
      tenantId,
      jobId,
      recoverySeq,
    );
  }

  releaseWorkerLeaseForHandoff(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    return releaseWorkerLeaseForHandoffTx(
      this.prisma,
      tenantId,
      jobId,
      leaseToken,
    );
  }

  extendWorkerLease(
    tenantId: string,
    jobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    return extendWorkerLeaseTx(this.prisma, tenantId, jobId, leaseToken);
  }

  claimWorkerLease(
    tenantId: string,
    jobId: string,
    phase: ImportWorkerPhase,
  ): Promise<ImportJobWorkerState | null> {
    return claimWorkerLeaseTx(this.prisma, tenantId, jobId, phase);
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

  findErrorRowsAfter(params: {
    tenantId: string;
    jobId: string;
    afterRowNo: number;
    take: number;
  }) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: params.tenantId,
        import_job_id: params.jobId,
        action: ImportRowAction.ERROR,
        row_no: { gt: params.afterRowNo },
      },
      orderBy: { row_no: 'asc' },
      take: params.take,
      select: {
        row_no: true,
        external_id: true,
        errors_json: true,
        normalized_json: true,
      },
    });
  }

  findPriceJumpRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        normalized_json: {
          path: ['price_jump_flagged'],
          equals: true,
        },
      },
      orderBy: { row_no: 'asc' },
    });
  }

  findApplyRowsByRowNos(tenantId: string, jobId: string, rowNos: number[]) {
    if (rowNos.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.importJobRow
      .findMany({
        where: {
          tenant_id: tenantId,
          import_job_id: jobId,
          row_no: { in: rowNos },
        },
        orderBy: { row_no: 'asc' },
      })
      .then((rows) => rows.map(toImportApplyRow));
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

  async countTechnicalErrorRows(
    tenantId: string,
    jobId: string,
  ): Promise<number> {
    const rows = (await this.findErrorRows(tenantId, jobId)) ?? [];
    return planTechnicalRetry(rows).count;
  }

  countApplyRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.count({
      where: { tenant_id: tenantId, import_job_id: jobId },
    });
  }

  async markFailedIfApplying(
    tenantId: string,
    jobId: string,
    applyFailureReason: ImportApplyFailureReason = 'apply_error',
    totals?: ImportJobTotals,
    failure?: ImportJobFailureDetail,
  ) {
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
      select: { options_json: true },
    });
    const options = importJobOptionsWithFailure(
      job?.options_json,
      applyFailureReason,
      failure,
    );
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: {
        status: ImportJobStatus.FAILED,
        failed_at: new Date(),
        options_json: options,
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

  lockForApply(
    tenantId: string,
    jobId: string,
    extraStatuses: ImportJobStatus[] = [],
    optionsOverride?: ImportJobOptionsWithWorker,
  ) {
    return lockForApplyTx(
      this.prisma,
      tenantId,
      jobId,
      extraStatuses,
      optionsOverride,
    );
  }

  lockForBackgroundApply(
    tenantId: string,
    jobId: string,
    options: ImportJobOptionsWithWorker,
    dryRunTotals: ImportJobTotals,
    applySequenceOrderKey: ImportApplySequenceOrderKey,
  ) {
    return lockForBackgroundApplyTx(
      this.prisma,
      tenantId,
      jobId,
      options,
      dryRunTotals,
      applySequenceOrderKey,
    );
  }
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
