import {
  ImportJobStatus,
  ImportRowAction,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  IMPORT_FAILED_JOB_ROW_RETENTION_DAYS,
  IMPORT_JOB_RETENTION_DAYS,
  IMPORT_UPLOAD_RETENTION_DAYS,
} from './import.constants.js';
import type { ImportJobTotals } from './import.types.js';

export const IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT = 25;
export const IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE = 500;

type PrismaLike = Pick<PrismaClient, 'importJob' | 'importJobRow'>;

export type ImportJobRowPurgeCounts = {
  jobs_scanned: number;
  rows_deleted: number;
  dry_run: boolean;
};

export type ImportJobRowPurgeCutoffs = {
  appliedCutoff: Date;
  failedCutoff: Date;
  dryRunCutoff: Date;
};

export type ImportJobRowPurgeOptions = {
  dryRun?: boolean;
  retentionDays?: number;
  failedRetentionDays?: number;
  dryRunRetentionDays?: number;
  jobsPerTenant?: number;
  rowBatchSize?: number;
};

export type ImportJobRowPurgeCandidate = {
  status: ImportJobStatus;
  createdAt?: Date;
  appliedAt?: Date | null;
  failed_at?: Date | null;
  cancelled_at?: Date | null;
  totals_json?: Prisma.JsonValue | null;
};

export function importJobRowPurgeCutoffs(
  now: Date,
  options: {
    retentionDays?: number;
    failedRetentionDays?: number;
    dryRunRetentionDays?: number;
  } = {},
): ImportJobRowPurgeCutoffs {
  return {
    appliedCutoff: new Date(
      now.getTime() -
        (options.retentionDays ?? IMPORT_JOB_RETENTION_DAYS) *
          24 *
          60 *
          60 *
          1000,
    ),
    failedCutoff: new Date(
      now.getTime() -
        (options.failedRetentionDays ?? IMPORT_FAILED_JOB_ROW_RETENTION_DAYS) *
          24 *
          60 *
          60 *
          1000,
    ),
    dryRunCutoff: new Date(
      now.getTime() -
        (options.dryRunRetentionDays ?? IMPORT_UPLOAD_RETENTION_DAYS) *
          24 *
          60 *
          60 *
          1000,
    ),
  };
}

/** Evaluates whether an import job is eligible for staged row purge. */
export function isImportJobEligibleForRowPurge(
  job: ImportJobRowPurgeCandidate,
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
): boolean {
  const cutoffs: ImportJobRowPurgeCutoffs =
    cutoffsInput instanceof Date
      ? {
          appliedCutoff: cutoffsInput,
          failedCutoff: cutoffsInput,
          dryRunCutoff: cutoffsInput,
        }
      : cutoffsInput;

  switch (job.status) {
    case ImportJobStatus.APPLIED:
      return (
        job.appliedAt !== null &&
        job.appliedAt !== undefined &&
        job.appliedAt < cutoffs.appliedCutoff
      );
    case ImportJobStatus.FAILED: {
      const terminalAt = job.failed_at ?? job.createdAt;
      return (
        terminalAt !== null &&
        terminalAt !== undefined &&
        terminalAt < cutoffs.failedCutoff
      );
    }
    case ImportJobStatus.CANCELLED: {
      const terminalAt = job.cancelled_at ?? job.createdAt;
      return (
        terminalAt !== null &&
        terminalAt !== undefined &&
        terminalAt < cutoffs.failedCutoff
      );
    }
    case ImportJobStatus.DRY_RUN_DONE:
      return (
        job.createdAt !== undefined && job.createdAt < cutoffs.dryRunCutoff
      );
    case ImportJobStatus.APPLYING:
    default:
      return false;
  }
}

export function eligibleImportJobsForRowPurgeWhere(
  tenantId: string,
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
): Prisma.ImportJobWhereInput {
  const cutoffs: ImportJobRowPurgeCutoffs =
    cutoffsInput instanceof Date
      ? {
          appliedCutoff: cutoffsInput,
          failedCutoff: cutoffsInput,
          dryRunCutoff: cutoffsInput,
        }
      : cutoffsInput;

  return {
    tenant_id: tenantId,
    OR: [
      {
        status: ImportJobStatus.APPLIED,
        appliedAt: { lt: cutoffs.appliedCutoff },
        rows: { some: {} },
      },
      {
        status: ImportJobStatus.CANCELLED,
        OR: [
          { cancelled_at: { lt: cutoffs.failedCutoff } },
          { cancelled_at: null, createdAt: { lt: cutoffs.failedCutoff } },
        ],
        rows: { some: {} },
      },
      {
        status: ImportJobStatus.FAILED,
        OR: [
          { failed_at: { lt: cutoffs.failedCutoff } },
          { failed_at: null, createdAt: { lt: cutoffs.failedCutoff } },
        ],
        rows: { some: {} },
      },
      {
        status: ImportJobStatus.DRY_RUN_DONE,
        createdAt: { lt: cutoffs.dryRunCutoff },
      },
    ],
  };
}

export function readImportJobRowRetentionPurgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): { dryRun: boolean } {
  const raw = env.IMPORT_JOB_ROW_RETENTION_DRY_RUN?.trim().toLowerCase();
  return { dryRun: raw === 'true' || raw === '1' };
}

/**
 * Deletes staged row payloads for stale import jobs while keeping job headers and external id mappings.
 * - APPLIED jobs older than 180 days: all staged rows purged.
 * - CANCELLED jobs older than 1 day: all staged rows purged.
 * - DRY_RUN_DONE jobs older than 7 days: transitioned to CANCELLED (cancel_reason: 'expired'), all staged rows purged.
 * - FAILED jobs older than 1 day: keeps ERROR rows when errors exist for errors.csv; purges all rows if no errors or > 180 days.
 */
type StalePurgeJob = {
  id: string;
  status: ImportJobStatus;
  options_json: Prisma.JsonValue | null;
  totals_json: Prisma.JsonValue | null;
  createdAt: Date;
  failed_at: Date | null;
  cancelled_at: Date | null;
  appliedAt: Date | null;
};

async function expireStaleDryRunJob(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
): Promise<void> {
  const jobOptions = (job.options_json ?? {}) as Record<string, unknown>;
  await prisma.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: job.id,
      status: ImportJobStatus.DRY_RUN_DONE,
    },
    data: {
      status: ImportJobStatus.CANCELLED,
      cancelled_at: now,
      options_json: {
        ...jobOptions,
        cancel_reason: 'expired',
      },
    },
  });
}

function resolveFailedJobActionFilter(
  job: StalePurgeJob,
  appliedCutoff: Date,
): Prisma.ImportJobRowWhereInput['action'] | undefined {
  const terminalAt = job.failed_at ?? job.createdAt;
  const isAncient = terminalAt < appliedCutoff;
  const totals = job.totals_json as ImportJobTotals | null;
  const errorCount = totals?.error ?? 0;
  if (!isAncient && errorCount > 0) {
    return { not: ImportRowAction.ERROR };
  }
  return undefined;
}

async function purgeRowsForStaleJob(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
  cutoffs: ImportJobRowPurgeCutoffs,
  rowBatchSize: number,
  dryRun: boolean,
): Promise<number> {
  if (job.status === ImportJobStatus.DRY_RUN_DONE) {
    if (!dryRun) {
      await expireStaleDryRunJob(prisma, tenantId, job, now);
    }
    return purgeRowsForJob(prisma, tenantId, job.id, rowBatchSize, dryRun);
  }

  if (job.status === ImportJobStatus.FAILED) {
    const actionFilter = resolveFailedJobActionFilter(
      job,
      cutoffs.appliedCutoff,
    );
    return purgeRowsForJob(
      prisma,
      tenantId,
      job.id,
      rowBatchSize,
      dryRun,
      actionFilter,
    );
  }

  return purgeRowsForJob(prisma, tenantId, job.id, rowBatchSize, dryRun);
}

export async function purgeStaleImportJobRowsForTenant(
  prisma: PrismaLike,
  tenantId: string,
  now: Date,
  options: ImportJobRowPurgeOptions = {},
): Promise<ImportJobRowPurgeCounts> {
  const dryRun = options.dryRun ?? false;
  const jobsPerTenant =
    options.jobsPerTenant ?? IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT;
  const rowBatchSize =
    options.rowBatchSize ?? IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE;
  const cutoffs = importJobRowPurgeCutoffs(now, options);

  const jobs = await prisma.importJob.findMany({
    where: eligibleImportJobsForRowPurgeWhere(tenantId, cutoffs),
    select: {
      id: true,
      status: true,
      options_json: true,
      totals_json: true,
      createdAt: true,
      failed_at: true,
      cancelled_at: true,
      appliedAt: true,
    },
    orderBy: { createdAt: 'asc' },
    take: jobsPerTenant,
  });

  let rowsDeleted = 0;
  for (const job of jobs) {
    rowsDeleted += await purgeRowsForStaleJob(
      prisma,
      tenantId,
      job,
      now,
      cutoffs,
      rowBatchSize,
      dryRun,
    );
  }

  return {
    jobs_scanned: jobs.length,
    rows_deleted: rowsDeleted,
    dry_run: dryRun,
  };
}

async function purgeRowsForJob(
  prisma: PrismaLike,
  tenantId: string,
  jobId: string,
  rowBatchSize: number,
  dryRun: boolean,
  actionFilter?: Prisma.ImportJobRowWhereInput['action'],
): Promise<number> {
  const rowWhere: Prisma.ImportJobRowWhereInput = {
    tenant_id: tenantId,
    import_job_id: jobId,
    ...(actionFilter !== undefined ? { action: actionFilter } : {}),
  };
  if (dryRun) {
    return prisma.importJobRow.count({ where: rowWhere });
  }

  let total = 0;
  for (;;) {
    const rows = await prisma.importJobRow.findMany({
      where: rowWhere,
      select: { row_no: true },
      orderBy: { row_no: 'asc' },
      take: rowBatchSize,
    });
    if (rows.length === 0) {
      return total;
    }
    const result = await prisma.importJobRow.deleteMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { in: rows.map((row) => row.row_no) },
      },
    });
    total += result.count;
    if (rows.length < rowBatchSize) {
      return total;
    }
  }
}
