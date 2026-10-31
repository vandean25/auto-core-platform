import { ImportJobStatus, ImportRowAction, type Prisma } from '@prisma/client';
import {
  eligibleImportJobsForRowPurgeWhere,
  importJobRowPurgeCutoffs,
  isImportJobEligibleForRowPurge,
  type ImportJobRowPurgeCutoffs,
} from './import-retention.helpers.js';

export type RetentionTestJob = {
  id: string;
  tenant_id: string;
  status: ImportJobStatus;
  appliedAt?: Date | null;
  failed_at?: Date | null;
  cancelled_at?: Date | null;
  createdAt: Date;
  totals_json?: Prisma.JsonValue | null;
  options_json?: Prisma.JsonValue | null;
};

export type RetentionTestRow = {
  row_no: number;
  action?: ImportRowAction | string;
};

type ImportJobFindManyArgs = {
  where: Prisma.ImportJobWhereInput;
  take?: number;
  orderBy?: { createdAt: 'asc' | 'desc' };
  select?: Record<string, boolean>;
};

function jobHasRows(
  rowsByJob: Map<string, RetentionTestRow[]>,
  jobId: string,
): boolean {
  return (rowsByJob.get(jobId)?.length ?? 0) > 0;
}

function matchesEligibleWhere(
  job: RetentionTestJob,
  rowsByJob: Map<string, RetentionTestRow[]>,
  where: Prisma.ImportJobWhereInput,
  cutoffs: ImportJobRowPurgeCutoffs | Date,
): boolean {
  if (where.tenant_id !== job.tenant_id) {
    return false;
  }
  // If the where clause requires rows: { some: {} }, check that the job has rows
  if (where.rows && !jobHasRows(rowsByJob, job.id)) {
    return false;
  }
  return isImportJobEligibleForRowPurge(
    {
      status: job.status,
      appliedAt: job.appliedAt,
      failed_at: job.failed_at,
      cancelled_at: job.cancelled_at,
      createdAt: job.createdAt,
      totals_json: job.totals_json,
    },
    cutoffs,
  );
}

function rowMatchesAction(
  row: RetentionTestRow,
  actionFilter?: Prisma.ImportJobRowWhereInput['action'],
): boolean {
  if (!actionFilter) return true;
  const rowAction = row.action ?? ImportRowAction.CREATE;
  if (typeof actionFilter === 'string') {
    return rowAction === actionFilter;
  }
  if (typeof actionFilter === 'object' && actionFilter !== null) {
    if ('in' in actionFilter && Array.isArray(actionFilter.in)) {
      return (actionFilter.in as string[]).includes(rowAction);
    }
    if ('not' in actionFilter && actionFilter.not) {
      return rowAction !== actionFilter.not;
    }
  }
  return true;
}

/** In-memory Prisma subset that evaluates the same eligibility rules as production. */
export function createImportRetentionPrismaFake(
  jobsInput: RetentionTestJob[],
  rowsByJobInput: Record<string, Array<number | RetentionTestRow>>,
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
) {
  const jobs = jobsInput.map((job) => ({ ...job }));
  const cutoffs: ImportJobRowPurgeCutoffs =
    cutoffsInput instanceof Date
      ? importJobRowPurgeCutoffs(cutoffsInput)
      : cutoffsInput;

  const rowsByJob = new Map<string, RetentionTestRow[]>(
    Object.entries(rowsByJobInput).map(([jobId, rows]) => [
      jobId,
      rows.map((r) =>
        typeof r === 'number'
          ? { row_no: r, action: ImportRowAction.CREATE }
          : { ...r, action: r.action ?? ImportRowAction.CREATE },
      ),
    ]),
  );

  const importJob = {
    findMany: jest.fn(async (args: ImportJobFindManyArgs) => {
      const eligible = jobs
        .filter((job) =>
          matchesEligibleWhere(job, rowsByJob, args.where, cutoffs),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const slice = eligible.slice(0, args.take ?? eligible.length);
      return slice.map((job) => ({
        id: job.id,
        status: job.status,
        options_json: job.options_json ?? null,
        totals_json: job.totals_json ?? null,
        createdAt: job.createdAt,
        failed_at: job.failed_at ?? null,
        cancelled_at: job.cancelled_at ?? null,
        appliedAt: job.appliedAt ?? null,
      }));
    }),
    updateMany: jest.fn(
      async (args: {
        where: { tenant_id?: string; id?: string; status?: ImportJobStatus };
        data: Prisma.ImportJobUpdateInput;
      }) => {
        let count = 0;
        for (const job of jobs) {
          if (args.where.tenant_id && job.tenant_id !== args.where.tenant_id)
            continue;
          if (args.where.id && job.id !== args.where.id) continue;
          if (args.where.status && job.status !== args.where.status) continue;
          if (args.data.status) job.status = args.data.status as ImportJobStatus;
          if (args.data.cancelled_at !== undefined)
            job.cancelled_at = args.data.cancelled_at as Date;
          if (args.data.options_json !== undefined)
            job.options_json = args.data.options_json as Prisma.JsonValue;
          count++;
        }
        return { count };
      },
    ),
    deleteMany: jest.fn(async () => {
      throw new Error('import_jobs must not be deleted during row purge');
    }),
  };

  const importJobRow = {
    count: jest.fn(
      async (args: {
        where: {
          tenant_id?: string;
          import_job_id: string;
          action?: Prisma.ImportJobRowWhereInput['action'];
        };
      }) => {
        const rows = rowsByJob.get(args.where.import_job_id) ?? [];
        return rows.filter((r) => rowMatchesAction(r, args.where.action)).length;
      },
    ),
    findMany: jest.fn(
      async (args: {
        where: {
          tenant_id: string;
          import_job_id: string;
          action?: Prisma.ImportJobRowWhereInput['action'];
        };
        take?: number;
      }) => {
        const rows = rowsByJob.get(args.where.import_job_id) ?? [];
        const matching = rows.filter((r) =>
          rowMatchesAction(r, args.where.action),
        );
        const slice = matching.slice(0, args.take ?? matching.length);
        return slice.map((row) => ({ row_no: row.row_no }));
      },
    ),
    deleteMany: jest.fn(
      async (args: {
        where: {
          tenant_id: string;
          import_job_id: string;
          row_no: { in: number[] };
        };
      }) => {
        const current = rowsByJob.get(args.where.import_job_id) ?? [];
        const toDelete = new Set(args.where.row_no.in);
        const remaining = current.filter((row) => !toDelete.has(row.row_no));
        rowsByJob.set(args.where.import_job_id, remaining);
        return { count: current.length - remaining.length };
      },
    ),
  };

  const externalIdMapping = {
    updateMany: jest.fn(async () => {
      throw new Error(
        'external_id_mappings must not be updated during row purge',
      );
    }),
    deleteMany: jest.fn(async () => {
      throw new Error(
        'external_id_mappings must not be deleted during row purge',
      );
    }),
  };

  return {
    prisma: { importJob, importJobRow, externalIdMapping },
    jobs,
    rowsByJob,
    expectedJobWhere: (tenantId: string) =>
      eligibleImportJobsForRowPurgeWhere(tenantId, cutoffs),
  };
}
