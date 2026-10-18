import {
  ImportJobStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { IMPORT_JOB_RETENTION_DAYS } from './import.constants.js';

export const IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT = 25;
export const IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE = 500;

type PrismaLike = Pick<PrismaClient, 'importJob' | 'importJobRow'>;

export type ImportJobRowPurgeCounts = {
  jobs_scanned: number;
  rows_deleted: number;
  dry_run: boolean;
};

export type ImportJobRowPurgeOptions = {
  dryRun?: boolean;
  retentionDays?: number;
  jobsPerTenant?: number;
  rowBatchSize?: number;
};

/** Terminal import jobs use appliedAt when present; dry-run-only jobs use createdAt. */
export function importJobFinishedAt(job: {
  status: ImportJobStatus;
  appliedAt: Date | null;
  createdAt: Date;
}): Date | null {
  if (job.status === ImportJobStatus.APPLYING) {
    return null;
  }
  if (job.status === ImportJobStatus.APPLIED) {
    return job.appliedAt ?? job.createdAt;
  }
  if (
    job.status === ImportJobStatus.FAILED ||
    job.status === ImportJobStatus.CANCELLED ||
    job.status === ImportJobStatus.DRY_RUN_DONE
  ) {
    return job.createdAt;
  }
  return null;
}

export function isImportJobEligibleForRowPurge(
  job: {
    status: ImportJobStatus;
    appliedAt: Date | null;
    createdAt: Date;
  },
  cutoff: Date,
): boolean {
  const finishedAt = importJobFinishedAt(job);
  return finishedAt !== null && finishedAt < cutoff;
}

export function importJobRowRetentionCutoff(
  now: Date,
  retentionDays: number = IMPORT_JOB_RETENTION_DAYS,
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export function eligibleImportJobsForRowPurgeWhere(
  tenantId: string,
  cutoff: Date,
): Prisma.ImportJobWhereInput {
  return {
    tenant_id: tenantId,
    status: { not: ImportJobStatus.APPLYING },
    rows: { some: {} },
    OR: [
      {
        status: ImportJobStatus.APPLIED,
        OR: [
          { appliedAt: { lt: cutoff } },
          { appliedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      {
        status: {
          in: [
            ImportJobStatus.FAILED,
            ImportJobStatus.CANCELLED,
            ImportJobStatus.DRY_RUN_DONE,
          ],
        },
        createdAt: { lt: cutoff },
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
 * Deletes row payloads for stale import jobs while keeping job headers and external id mappings.
 * Job totals on `import_jobs` are unchanged.
 */
export async function purgeStaleImportJobRowsForTenant(
  prisma: PrismaLike,
  tenantId: string,
  now: Date,
  options: ImportJobRowPurgeOptions = {},
): Promise<ImportJobRowPurgeCounts> {
  const retentionDays = options.retentionDays ?? IMPORT_JOB_RETENTION_DAYS;
  const dryRun = options.dryRun ?? false;
  const jobsPerTenant =
    options.jobsPerTenant ?? IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT;
  const rowBatchSize =
    options.rowBatchSize ?? IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE;
  const cutoff = importJobRowRetentionCutoff(now, retentionDays);

  const jobs = await prisma.importJob.findMany({
    where: eligibleImportJobsForRowPurgeWhere(tenantId, cutoff),
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: jobsPerTenant,
  });

  let rowsDeleted = 0;
  for (const job of jobs) {
    rowsDeleted += await purgeRowsForJob(
      prisma,
      tenantId,
      job.id,
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
): Promise<number> {
  const rowWhere = { tenant_id: tenantId, import_job_id: jobId };
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
