import { ImportJobStatus, type Prisma } from '@prisma/client';
import {
  eligibleImportJobsForRowPurgeWhere,
  isImportJobEligibleForRowPurge,
} from './import-retention.helpers.js';

export type RetentionTestJob = {
  id: string;
  tenant_id: string;
  status: ImportJobStatus;
  appliedAt: Date | null;
  createdAt: Date;
};

type ImportJobFindManyArgs = {
  where: Prisma.ImportJobWhereInput;
  take?: number;
  orderBy?: { createdAt: 'asc' | 'desc' };
};

function jobHasRows(
  rowsByJob: Map<string, number[]>,
  jobId: string,
): boolean {
  return (rowsByJob.get(jobId)?.length ?? 0) > 0;
}

function matchesEligibleWhere(
  job: RetentionTestJob,
  rowsByJob: Map<string, number[]>,
  where: Prisma.ImportJobWhereInput,
  cutoff: Date,
): boolean {
  if (where.tenant_id !== job.tenant_id) {
    return false;
  }
  if (!jobHasRows(rowsByJob, job.id)) {
    return false;
  }
  return isImportJobEligibleForRowPurge(
    { status: job.status, appliedAt: job.appliedAt },
    cutoff,
  );
}

/** In-memory Prisma subset that evaluates the same eligibility rules as production. */
export function createImportRetentionPrismaFake(
  jobs: RetentionTestJob[],
  rowsByJobInput: Record<string, number[]>,
  cutoffForWhere: Date,
) {
  const rowsByJob = new Map(
    Object.entries(rowsByJobInput).map(([jobId, rowNos]) => [
      jobId,
      [...rowNos],
    ]),
  );

  const importJob = {
    findMany: jest.fn(async (args: ImportJobFindManyArgs) => {
      const eligible = jobs
        .filter((job) =>
          matchesEligibleWhere(job, rowsByJob, args.where, cutoffForWhere),
        )
        .sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      const slice = eligible.slice(0, args.take ?? eligible.length);
      return slice.map((job) => ({ id: job.id }));
    }),
    updateMany: jest.fn(async () => {
      throw new Error('import_jobs must not be updated during row purge');
    }),
    deleteMany: jest.fn(async () => {
      throw new Error('import_jobs must not be deleted during row purge');
    }),
  };

  const importJobRow = {
    count: jest.fn(async (args: { where: { import_job_id: string } }) => {
      const rowNos = rowsByJob.get(args.where.import_job_id) ?? [];
      return rowNos.length;
    }),
    findMany: jest.fn(
      async (args: {
        where: { tenant_id: string; import_job_id: string };
        take?: number;
      }) => {
        const rowNos = rowsByJob.get(args.where.import_job_id) ?? [];
        const slice = rowNos.slice(0, args.take ?? rowNos.length);
        return slice.map((row_no) => ({ row_no }));
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
        const remaining = current.filter((row) => !toDelete.has(row));
        rowsByJob.set(args.where.import_job_id, remaining);
        return { count: current.length - remaining.length };
      },
    ),
  };

  const externalIdMapping = {
    updateMany: jest.fn(async () => {
      throw new Error('external_id_mappings must not be updated during row purge');
    }),
    deleteMany: jest.fn(async () => {
      throw new Error('external_id_mappings must not be deleted during row purge');
    }),
  };

  return {
    prisma: { importJob, importJobRow, externalIdMapping },
    rowsByJob,
    expectedJobWhere: (tenantId: string) =>
      eligibleImportJobsForRowPurgeWhere(tenantId, cutoffForWhere),
  };
}
