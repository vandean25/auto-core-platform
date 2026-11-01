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
  updatedAt?: Date;
  totals_json?: Prisma.JsonValue | null;
  options_json?: Prisma.JsonValue | null;
};

export type RetentionTestRow = {
  row_no: number;
  action?: ImportRowAction;
};

type ImportJobFindManyArgs = {
  where: Prisma.ImportJobWhereInput;
  skip?: number;
  take?: number;
  orderBy?: { createdAt: 'asc' | 'desc' };
  select?: Record<string, boolean>;
};

type UpdateManyArgs = {
  where: {
    tenant_id?: string;
    id?: string;
    status?: ImportJobStatus;
    NOT?: { options_json?: { path?: string[]; equals?: unknown } };
  };
  data: Prisma.ImportJobUpdateInput;
};

function matchesRowsFilter(
  rows: RetentionTestRow[],
  rowsWhere?: Prisma.ImportJobRowListRelationFilter,
): boolean {
  if (!rowsWhere?.some) return true;
  const someFilter = rowsWhere.some;
  if (!someFilter.action) return rows.length > 0;
  return rows.some((row) => rowMatchesAction(row, someFilter.action));
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
  const rows = rowsByJob.get(job.id) ?? [];
  if (where.rows && !matchesRowsFilter(rows, where.rows)) {
    return false;
  }
  return isImportJobEligibleForRowPurge(
    {
      status: job.status,
      appliedAt: job.appliedAt,
      failed_at: job.failed_at,
      cancelled_at: job.cancelled_at,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      totals_json: job.totals_json,
      options_json: job.options_json,
    },
    cutoffs,
  );
}

function matchesInFilter(
  rowAction: ImportRowAction,
  inFilter: unknown,
): boolean {
  return Array.isArray(inFilter) && inFilter.includes(rowAction);
}

function matchesNotFilter(
  rowAction: ImportRowAction,
  notFilter: unknown,
): boolean {
  return notFilter !== undefined && rowAction !== notFilter;
}

function matchesObjectFilter(
  rowAction: ImportRowAction,
  filter: Record<string, unknown>,
): boolean {
  if ('not' in filter) {
    return matchesNotFilter(rowAction, filter.not);
  }
  if ('in' in filter) {
    return matchesInFilter(rowAction, filter.in);
  }
  return true;
}

export function rowMatchesAction(
  row: RetentionTestRow,
  actionFilter?: Prisma.ImportJobRowWhereInput['action'],
): boolean {
  if (!actionFilter) return true;
  const rowAction = row.action ?? ImportRowAction.CREATE;
  if (typeof actionFilter === 'string') {
    return rowAction === actionFilter;
  }
  return matchesObjectFilter(rowAction, actionFilter);
}

function matchesTenantAndId(
  job: RetentionTestJob,
  where: UpdateManyArgs['where'],
): boolean {
  if (where.tenant_id && job.tenant_id !== where.tenant_id) return false;
  return !(where.id && job.id !== where.id);
}

function matchesNotPurged(
  job: RetentionTestJob,
  notOptions?: UpdateManyArgs['where']['NOT'],
): boolean {
  if (!notOptions?.options_json) return true;
  const opts = (job.options_json ?? {}) as Record<string, unknown>;
  const isPurgedFilter = notOptions.options_json.path?.[0] === 'rows_purged';
  return !(isPurgedFilter && opts.rows_purged === true);
}

export function matchesJobUpdateWhere(
  job: RetentionTestJob,
  where: UpdateManyArgs['where'],
): boolean {
  if (!matchesTenantAndId(job, where)) return false;
  if (where.status && job.status !== where.status) return false;
  return matchesNotPurged(job, where.NOT);
}

function updateJobIfMatching(
  job: RetentionTestJob,
  where: UpdateManyArgs['where'],
  data: Prisma.ImportJobUpdateInput,
): boolean {
  if (!matchesJobUpdateWhere(job, where)) {
    return false;
  }
  Object.assign(job, data);
  return true;
}

function normalizeCutoffs(
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
): ImportJobRowPurgeCutoffs {
  return cutoffsInput instanceof Date
    ? importJobRowPurgeCutoffs(cutoffsInput)
    : cutoffsInput;
}

function buildRowsByJobMap(
  rowsByJobInput: Record<string, Array<number | RetentionTestRow>>,
): Map<string, RetentionTestRow[]> {
  return new Map<string, RetentionTestRow[]>(
    Object.entries(rowsByJobInput).map(([jobId, rows]) => [
      jobId,
      rows.map((r) =>
        typeof r === 'number'
          ? { row_no: r, action: ImportRowAction.CREATE }
          : { ...r, action: r.action ?? ImportRowAction.CREATE },
      ),
    ]),
  );
}

function buildImportJobMock(
  jobs: RetentionTestJob[],
  rowsByJob: Map<string, RetentionTestRow[]>,
  cutoffs: ImportJobRowPurgeCutoffs,
) {
  return {
    findFirst: jest.fn(
      async (args: { where: { tenant_id?: string; id?: string } }) => {
        const job = jobs.find(
          (j) =>
            (!args.where.tenant_id || j.tenant_id === args.where.tenant_id) &&
            (!args.where.id || j.id === args.where.id),
        );
        if (!job) return null;
        return {
          id: job.id,
          status: job.status,
          options_json: job.options_json ?? null,
        };
      },
    ),
    findMany: jest.fn(async (args: ImportJobFindManyArgs) => {
      const eligible = jobs
        .filter((job) =>
          matchesEligibleWhere(job, rowsByJob, args.where, cutoffs),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const start = args.skip ?? 0;
      const end = args.take !== undefined ? start + args.take : undefined;
      const slice = eligible.slice(start, end);
      return slice.map((job) => ({
        id: job.id,
        status: job.status,
        options_json: job.options_json ?? null,
        totals_json: job.totals_json ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt ?? job.createdAt,
        failed_at: job.failed_at ?? null,
        cancelled_at: job.cancelled_at ?? null,
        appliedAt: job.appliedAt ?? null,
      }));
    }),
    updateMany: jest.fn(async (args: UpdateManyArgs) => {
      let count = 0;
      for (const job of jobs) {
        if (updateJobIfMatching(job, args.where, args.data)) {
          count++;
        }
      }
      return { count };
    }),
    deleteMany: jest.fn(async () => {
      throw new Error('import_jobs must not be deleted during row purge');
    }),
  };
}

function jobMatchesExpectedStatus(
  jobId: string,
  jobs: RetentionTestJob[],
  expectedStatus?: ImportJobStatus,
): boolean {
  if (!expectedStatus) return true;
  const job = jobs.find((j) => j.id === jobId);
  return job?.status === expectedStatus;
}

function buildImportJobRowMock(
  jobs: RetentionTestJob[],
  rowsByJob: Map<string, RetentionTestRow[]>,
) {
  return {
    count: jest.fn(
      async (args: {
        where: {
          tenant_id?: string;
          import_job_id: string;
          action?: Prisma.ImportJobRowWhereInput['action'];
          import_job?: { is?: { status?: ImportJobStatus } };
        };
      }) => {
        const expectedStatus = args.where.import_job?.is?.status;
        if (
          !jobMatchesExpectedStatus(
            args.where.import_job_id,
            jobs,
            expectedStatus,
          )
        ) {
          return 0;
        }
        const rows = rowsByJob.get(args.where.import_job_id) ?? [];
        return rows.filter((r) => rowMatchesAction(r, args.where.action))
          .length;
      },
    ),
    findMany: jest.fn(
      async (args: {
        where: {
          tenant_id: string;
          import_job_id: string;
          action?: Prisma.ImportJobRowWhereInput['action'];
          import_job?: { is?: { status?: ImportJobStatus } };
        };
        take?: number;
      }) => {
        const expectedStatus = args.where.import_job?.is?.status;
        if (
          !jobMatchesExpectedStatus(
            args.where.import_job_id,
            jobs,
            expectedStatus,
          )
        ) {
          return [];
        }
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
          import_job?: { is?: { status?: ImportJobStatus } };
        };
      }) => {
        const expectedStatus = args.where.import_job?.is?.status;
        if (
          !jobMatchesExpectedStatus(
            args.where.import_job_id,
            jobs,
            expectedStatus,
          )
        ) {
          return { count: 0 };
        }
        const current = rowsByJob.get(args.where.import_job_id) ?? [];
        const toDelete = new Set(args.where.row_no.in);
        const remaining = current.filter((row) => !toDelete.has(row.row_no));
        rowsByJob.set(args.where.import_job_id, remaining);
        return { count: current.length - remaining.length };
      },
    ),
  };
}

function buildExternalIdMappingMock() {
  return {
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
}

function buildAuditLogMock() {
  return {
    create: jest.fn(async (args: unknown) => ({ id: 'audit-1', args })),
  };
}

/** In-memory Prisma subset that evaluates the same eligibility rules as production. */
export function createImportRetentionPrismaFake(
  jobsInput: RetentionTestJob[],
  rowsByJobInput: Record<string, Array<number | RetentionTestRow>>,
  cutoffsInput: ImportJobRowPurgeCutoffs | Date,
) {
  const jobs = jobsInput.map((job) => ({ ...job }));
  const cutoffs = normalizeCutoffs(cutoffsInput);
  const rowsByJob = buildRowsByJobMap(rowsByJobInput);

  return {
    prisma: {
      importJob: buildImportJobMock(jobs, rowsByJob, cutoffs),
      importJobRow: buildImportJobRowMock(jobs, rowsByJob),
      externalIdMapping: buildExternalIdMappingMock(),
      auditLog: buildAuditLogMock(),
    },
    jobs,
    rowsByJob,
    expectedJobWhere: (tenantId: string) =>
      eligibleImportJobsForRowPurgeWhere(tenantId, cutoffs),
  };
}
