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

/** Only applied jobs with a recorded apply timestamp are eligible for row purge. */
export function isImportJobEligibleForRowPurge(
  job: {
    status: ImportJobStatus;
    appliedAt: Date | null;
  },
  cutoff: Date,
): boolean {
  return (
    job.status === ImportJobStatus.APPLIED &&
    job.appliedAt !== null &&
    job.appliedAt < cutoff
  );
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
    status: ImportJobStatus.APPLIED,
    appliedAt: { lt: cutoff },
    rows: { some: {} },
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
