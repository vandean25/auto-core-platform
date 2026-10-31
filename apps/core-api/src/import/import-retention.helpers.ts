import {
  AuditActorType,
  AuditLogAction,
  ImportJobStatus,
  ImportRowAction,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  IMPORT_FAILED_JOB_ROW_RETENTION_DAYS,
  IMPORT_JOB_RETENTION_DAYS,
  IMPORT_SOURCE,
} from './import.constants.js';
import {
  readImportJobRowPurgeRowBatchSize,
  readImportJobRowPurgeRowBudget,
  readImportUploadRetentionDays,
} from './import-limits.js';

export const IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT = 25;
export const IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE =
  readImportJobRowPurgeRowBatchSize();

type PrismaLike = Pick<PrismaClient, 'importJob' | 'importJobRow'> & {
  auditLog?: Pick<PrismaClient['auditLog'], 'create'>;
};

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

export type ImportJobRowPurgeLogger = {
  warn: (message: string, error?: unknown) => void;
};

export type ImportJobRowPurgeOptions = {
  dryRun?: boolean;
  retentionDays?: number;
  failedRetentionDays?: number;
  dryRunRetentionDays?: number;
  jobsPerTenant?: number;
  rowBatchSize?: number;
  rowBudget?: number;
  logger?: ImportJobRowPurgeLogger;
};

export type ImportJobRowPurgeCandidate = {
  status: ImportJobStatus;
  createdAt?: Date;
  updatedAt?: Date;
  appliedAt?: Date | null;
  failed_at?: Date | null;
  cancelled_at?: Date | null;
  totals_json?: Prisma.JsonValue | null;
  options_json?: Prisma.JsonValue | null;
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
        (options.dryRunRetentionDays ?? readImportUploadRetentionDays()) *
          24 *
          60 *
          60 *
          1000,
    ),
  };
}

function isJobAlreadyPurged(job: ImportJobRowPurgeCandidate): boolean {
  const options = job.options_json as
    Record<string, unknown> | null | undefined;
  return (
    Boolean(options?.rows_purged) && options?.rows_purge_completed !== false
  );
}

function isApplyPhaseWorker(job: ImportJobRowPurgeCandidate): boolean {
  const options = job.options_json as
    Record<string, unknown> | null | undefined;
  const worker = options?.worker as { phase?: string } | undefined;
  return worker?.phase === 'apply';
}

function resolveCutoffs(
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
): ImportJobRowPurgeCutoffs {
  return cutoffsInput instanceof Date
    ? {
        appliedCutoff: cutoffsInput,
        failedCutoff: cutoffsInput,
        dryRunCutoff: cutoffsInput,
      }
    : cutoffsInput;
}

function isAppliedJobEligible(
  job: ImportJobRowPurgeCandidate,
  cutoffs: ImportJobRowPurgeCutoffs,
): boolean {
  return Boolean(
    job.appliedAt !== null &&
    job.appliedAt !== undefined &&
    job.appliedAt < cutoffs.appliedCutoff,
  );
}

function isFailedJobEligible(
  job: ImportJobRowPurgeCandidate,
  cutoffs: ImportJobRowPurgeCutoffs,
): boolean {
  const terminalAt = job.failed_at ?? job.updatedAt ?? job.createdAt;
  if (!terminalAt) return false;
  if (terminalAt < cutoffs.appliedCutoff) return true;
  if (isApplyPhaseWorker(job) || isJobAlreadyPurged(job)) return false;
  return terminalAt < cutoffs.failedCutoff;
}

function isCancelledJobEligible(
  job: ImportJobRowPurgeCandidate,
  cutoffs: ImportJobRowPurgeCutoffs,
): boolean {
  const terminalAt = job.cancelled_at ?? job.updatedAt ?? job.createdAt;
  if (!terminalAt) return false;
  if (terminalAt < cutoffs.appliedCutoff) return true;
  if (isJobAlreadyPurged(job)) return false;
  const options = job.options_json as
    Record<string, unknown> | null | undefined;
  if (options?.cancel_reason === 'expired') {
    return true;
  }
  return terminalAt < cutoffs.failedCutoff;
}

function isDryRunJobEligible(
  job: ImportJobRowPurgeCandidate,
  cutoffs: ImportJobRowPurgeCutoffs,
): boolean {
  const completedAt = job.updatedAt ?? job.createdAt;
  return Boolean(completedAt && completedAt < cutoffs.dryRunCutoff);
}

/** Evaluates whether an import job is eligible for staged row purge. */
export function isImportJobEligibleForRowPurge(
  job: ImportJobRowPurgeCandidate,
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
): boolean {
  const cutoffs = resolveCutoffs(cutoffsInput);
  switch (job.status) {
    case ImportJobStatus.APPLIED:
      return isAppliedJobEligible(job, cutoffs);
    case ImportJobStatus.FAILED:
      return isFailedJobEligible(job, cutoffs);
    case ImportJobStatus.CANCELLED:
      return isCancelledJobEligible(job, cutoffs);
    case ImportJobStatus.DRY_RUN_DONE:
      return isDryRunJobEligible(job, cutoffs);
    default:
      return false;
  }
}

export function eligibleImportJobsForRowPurgeWhere(
  tenantId: string,
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
): Prisma.ImportJobWhereInput {
  const cutoffs = resolveCutoffs(cutoffsInput);

  return {
    tenant_id: tenantId,
    OR: [
      {
        status: ImportJobStatus.APPLIED,
        appliedAt: { lt: cutoffs.appliedCutoff },
        rows: { some: {} },
      },
      {
        status: ImportJobStatus.DRY_RUN_DONE,
        updatedAt: { lt: cutoffs.dryRunCutoff },
      },
      {
        status: ImportJobStatus.CANCELLED,
        OR: [
          {
            OR: [
              { cancelled_at: { lt: cutoffs.appliedCutoff } },
              { cancelled_at: null, createdAt: { lt: cutoffs.appliedCutoff } },
            ],
            rows: { some: {} },
          },
          {
            OR: [
              { cancelled_at: { lt: cutoffs.failedCutoff } },
              { cancelled_at: null, updatedAt: { lt: cutoffs.failedCutoff } },
              { cancelled_at: null, createdAt: { lt: cutoffs.failedCutoff } },
              { createdAt: { lt: cutoffs.dryRunCutoff } },
            ],
            rows: { some: { action: { not: ImportRowAction.ERROR } } },
          },
        ],
      },
      {
        status: ImportJobStatus.FAILED,
        OR: [
          {
            OR: [
              { failed_at: { lt: cutoffs.appliedCutoff } },
              { failed_at: null, createdAt: { lt: cutoffs.appliedCutoff } },
            ],
            rows: { some: {} },
          },
          {
            OR: [
              { failed_at: { lt: cutoffs.failedCutoff } },
              { failed_at: null, updatedAt: { lt: cutoffs.failedCutoff } },
              { failed_at: null, createdAt: { lt: cutoffs.failedCutoff } },
            ],
            rows: { some: { action: { not: ImportRowAction.ERROR } } },
          },
        ],
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

type StalePurgeJob = {
  id: string;
  status: ImportJobStatus;
  options_json: Prisma.JsonValue | null;
  totals_json: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt?: Date;
  failed_at: Date | null;
  cancelled_at: Date | null;
  appliedAt: Date | null;
};

async function recordPurgeAuditLog(
  prisma: PrismaLike,
  tenantId: string,
  jobId: string,
  event: string,
  details: Record<string, unknown>,
  logger?: ImportJobRowPurgeLogger,
): Promise<void> {
  if (!prisma.auditLog) {
    return;
  }
  try {
    await prisma.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: 'ImportJob',
        entity_id: jobId,
        action: AuditLogAction.UPDATE,
        actor_user_id: 'system',
        actor_type: AuditActorType.SYSTEM,
        source: IMPORT_SOURCE,
        after: {
          event,
          importJobId: jobId,
          ...details,
        },
      },
    });
  } catch (err) {
    logger?.warn(
      `Failed to record audit log for ${event} on import job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function expireStaleDryRunJob(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
  logger?: ImportJobRowPurgeLogger,
): Promise<boolean> {
  const jobOptions = (job.options_json ?? {}) as Record<string, unknown>;
  const res = await prisma.importJob.updateMany({
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
        rows_purged: true,
        rows_purge_completed: false,
        purged_at: now.toISOString(),
      },
    },
  });
  if (res.count !== 1) {
    return false;
  }
  await recordPurgeAuditLog(
    prisma,
    tenantId,
    job.id,
    'import_job.expired',
    { cancel_reason: 'expired' },
    logger,
  );
  return true;
}

async function markJobPurged(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
  logger?: ImportJobRowPurgeLogger,
): Promise<boolean> {
  const jobOptions = (job.options_json ?? {}) as Record<string, unknown>;
  if (jobOptions.rows_purged === true) {
    return true;
  }
  const res = await prisma.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: job.id,
      status: job.status,
    },
    data: {
      options_json: {
        ...jobOptions,
        rows_purged: true,
        rows_purge_completed: false,
        purged_at: now.toISOString(),
      },
    },
  });
  if (res.count !== 1) {
    return false;
  }
  await recordPurgeAuditLog(
    prisma,
    tenantId,
    job.id,
    'import_job.purged',
    { status: job.status },
    logger,
  );
  return true;
}

async function markPurgeCompleted(
  prisma: PrismaLike,
  tenantId: string,
  jobId: string,
  currentStatus: ImportJobStatus,
): Promise<void> {
  const current = await prisma.importJob.findFirst?.({
    where: { tenant_id: tenantId, id: jobId },
    select: { options_json: true },
  });
  const currentOptions = (current?.options_json ?? {}) as Record<
    string,
    unknown
  >;
  await prisma.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: currentStatus,
    },
    data: {
      options_json: {
        ...currentOptions,
        rows_purged: true,
        rows_purge_completed: true,
      },
    },
  });
}

function resolveJobTerminalAt(job: StalePurgeJob): Date {
  if (job.status === ImportJobStatus.APPLIED) {
    return job.appliedAt ?? job.createdAt;
  }
  return job.failed_at ?? job.cancelled_at ?? job.updatedAt ?? job.createdAt;
}

function resolveJobActionFilter(
  job: StalePurgeJob,
  appliedCutoff: Date,
): Prisma.ImportJobRowWhereInput['action'] | undefined {
  const isAncient = resolveJobTerminalAt(job) < appliedCutoff;
  if (!isAncient) {
    return { not: ImportRowAction.ERROR };
  }
  return undefined;
}

async function finalizeTerminalJobPurge(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  isAncient: boolean,
  result: PurgeRowsResult,
  logger?: ImportJobRowPurgeLogger,
): Promise<void> {
  if (result.completed && !isAncient) {
    await markPurgeCompleted(prisma, tenantId, job.id, job.status);
  }
  if (isAncient && result.deleted > 0) {
    await recordPurgeAuditLog(
      prisma,
      tenantId,
      job.id,
      'import_job.ancient_purged',
      { status: job.status, rows_deleted: result.deleted },
      logger,
    );
  }
}

type PurgeRowsResult = {
  deleted: number;
  completed: boolean;
};

async function purgeRowsForJob(
  prisma: PrismaLike,
  tenantId: string,
  jobId: string,
  expectedStatus: ImportJobStatus,
  rowBatchSize: number,
  dryRun: boolean,
  actionFilter?: Prisma.ImportJobRowWhereInput['action'],
  rowBudgetRemaining: number = Infinity,
): Promise<PurgeRowsResult> {
  const rowWhere: Prisma.ImportJobRowWhereInput = {
    tenant_id: tenantId,
    import_job_id: jobId,
    import_job: { is: { status: expectedStatus } },
    ...(actionFilter !== undefined ? { action: actionFilter } : {}),
  };
  if (dryRun) {
    const count = await prisma.importJobRow.count({ where: rowWhere });
    const take = Math.min(count, rowBudgetRemaining);
    return {
      deleted: take,
      completed: count <= rowBudgetRemaining,
    };
  }

  let total = 0;
  for (;;) {
    const batchTake = Math.min(rowBatchSize, rowBudgetRemaining - total);
    if (batchTake <= 0) {
      return { deleted: total, completed: false };
    }
    const rows = await prisma.importJobRow.findMany({
      where: rowWhere,
      select: { row_no: true },
      orderBy: { row_no: 'asc' },
      take: batchTake,
    });
    if (rows.length === 0) {
      return { deleted: total, completed: true };
    }
    const result = await prisma.importJobRow.deleteMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { in: rows.map((row) => row.row_no) },
        import_job: { is: { status: expectedStatus } },
      },
    });
    total += result.count;
    if (result.count === 0 || rows.length < batchTake) {
      return { deleted: total, completed: true };
    }
    if (total >= rowBudgetRemaining) {
      return { deleted: total, completed: false };
    }
  }
}

async function purgeStaleDryRunJobRows(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
  cutoffs: ImportJobRowPurgeCutoffs,
  rowBatchSize: number,
  dryRun: boolean,
  rowBudgetRemaining: number,
  logger?: ImportJobRowPurgeLogger,
): Promise<number> {
  if (!dryRun) {
    const expired = await expireStaleDryRunJob(
      prisma,
      tenantId,
      job,
      now,
      logger,
    );
    if (!expired) return 0;
  }
  const actionFilter = resolveJobActionFilter(job, cutoffs.appliedCutoff);
  const result = await purgeRowsForJob(
    prisma,
    tenantId,
    job.id,
    dryRun ? ImportJobStatus.DRY_RUN_DONE : ImportJobStatus.CANCELLED,
    rowBatchSize,
    dryRun,
    actionFilter,
    rowBudgetRemaining,
  );
  if (!dryRun && result.completed) {
    await markPurgeCompleted(
      prisma,
      tenantId,
      job.id,
      ImportJobStatus.CANCELLED,
    );
  }
  return result.deleted;
}

async function purgeTerminalJobRows(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
  cutoffs: ImportJobRowPurgeCutoffs,
  rowBatchSize: number,
  dryRun: boolean,
  rowBudgetRemaining: number,
  logger?: ImportJobRowPurgeLogger,
): Promise<number> {
  const isAncient = resolveJobTerminalAt(job) < cutoffs.appliedCutoff;
  if (!dryRun && !isAncient) {
    const marked = await markJobPurged(prisma, tenantId, job, now, logger);
    if (!marked) return 0;
  }
  const actionFilter = resolveJobActionFilter(job, cutoffs.appliedCutoff);
  const result = await purgeRowsForJob(
    prisma,
    tenantId,
    job.id,
    job.status,
    rowBatchSize,
    dryRun,
    actionFilter,
    rowBudgetRemaining,
  );
  if (!dryRun) {
    await finalizeTerminalJobPurge(
      prisma,
      tenantId,
      job,
      isAncient,
      result,
      logger,
    );
  }
  return result.deleted;
}

async function purgeRowsForStaleJob(
  prisma: PrismaLike,
  tenantId: string,
  job: StalePurgeJob,
  now: Date,
  cutoffs: ImportJobRowPurgeCutoffs,
  rowBatchSize: number,
  dryRun: boolean,
  rowBudgetRemaining: number,
  logger?: ImportJobRowPurgeLogger,
): Promise<number> {
  if (job.status === ImportJobStatus.DRY_RUN_DONE) {
    return purgeStaleDryRunJobRows(
      prisma,
      tenantId,
      job,
      now,
      cutoffs,
      rowBatchSize,
      dryRun,
      rowBudgetRemaining,
      logger,
    );
  }
  return purgeTerminalJobRows(
    prisma,
    tenantId,
    job,
    now,
    cutoffs,
    rowBatchSize,
    dryRun,
    rowBudgetRemaining,
    logger,
  );
}

async function fetchEligiblePurgeJobs(
  prisma: PrismaLike,
  tenantId: string,
  cutoffs: ImportJobRowPurgeCutoffs,
  targetCount: number,
): Promise<StalePurgeJob[]> {
  const eligible: StalePurgeJob[] = [];
  const pageSize = Math.max(targetCount, 25);
  let skip = 0;

  while (eligible.length < targetCount) {
    const batch = await prisma.importJob.findMany({
      where: eligibleImportJobsForRowPurgeWhere(tenantId, cutoffs),
      select: {
        id: true,
        status: true,
        options_json: true,
        totals_json: true,
        createdAt: true,
        updatedAt: true,
        failed_at: true,
        cancelled_at: true,
        appliedAt: true,
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take: pageSize,
    });

    if (batch.length === 0) {
      break;
    }

    for (const job of batch) {
      if (isImportJobEligibleForRowPurge(job, cutoffs)) {
        eligible.push(job);
        if (eligible.length >= targetCount) {
          break;
        }
      }
    }

    skip += batch.length;
    if (batch.length < pageSize) {
      break;
    }
  }

  return eligible;
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
  const rowBudget = options.rowBudget ?? readImportJobRowPurgeRowBudget();
  const cutoffs = importJobRowPurgeCutoffs(now, options);

  const jobs = await fetchEligiblePurgeJobs(
    prisma,
    tenantId,
    cutoffs,
    jobsPerTenant,
  );

  let rowsDeleted = 0;
  for (const job of jobs) {
    if (rowsDeleted >= rowBudget) {
      break;
    }
    rowsDeleted += await purgeRowsForStaleJob(
      prisma,
      tenantId,
      job,
      now,
      cutoffs,
      rowBatchSize,
      dryRun,
      rowBudget - rowsDeleted,
      options.logger,
    );
  }

  return {
    jobs_scanned: jobs.length,
    rows_deleted: rowsDeleted,
    dry_run: dryRun,
  };
}
