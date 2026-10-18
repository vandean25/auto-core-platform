import { ImportJobStatus } from '@prisma/client';
import { IMPORT_JOB_RETENTION_DAYS } from './import.constants.js';
import {
  eligibleImportJobsForRowPurgeWhere,
  importJobFinishedAt,
  importJobRowRetentionCutoff,
  isImportJobEligibleForRowPurge,
  purgeStaleImportJobRowsForTenant,
} from './import-retention.helpers.js';

describe('importJobFinishedAt', () => {
  it('returns null for jobs still applying', () => {
    expect(
      importJobFinishedAt({
        status: ImportJobStatus.APPLYING,
        appliedAt: null,
        createdAt: new Date('2020-01-01'),
      }),
    ).toBeNull();
  });
});

describe('isImportJobEligibleForRowPurge', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  const cutoff = importJobRowRetentionCutoff(now, IMPORT_JOB_RETENTION_DAYS);

  it('purges applied jobs finished before the retention cutoff but not on the boundary', () => {
    const onBoundary = new Date(cutoff.getTime());
    const beforeBoundary = new Date(cutoff.getTime() - 1);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.APPLIED,
          appliedAt: onBoundary,
          createdAt: new Date('2020-01-01'),
        },
        cutoff,
      ),
    ).toBe(false);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.APPLIED,
          appliedAt: beforeBoundary,
          createdAt: new Date('2020-01-01'),
        },
        cutoff,
      ),
    ).toBe(true);
  });
});

describe('purgeStaleImportJobRowsForTenant', () => {
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';
  const now = new Date('2026-06-01T12:00:00.000Z');

  function makePrisma(state: {
    jobs: Array<{ id: string; tenant_id: string }>;
    rowsByJob: Record<string, number[]>;
  }) {
    const rowsByJob = new Map(
      Object.entries(state.rowsByJob).map(([jobId, rowNos]) => [
        jobId,
        [...rowNos],
      ]),
    );
    return {
      importJobRow: {
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
      },
      importJob: {
        findMany: jest.fn(
          async (args: {
            where: { tenant_id: string };
            take?: number;
          }) => {
            const eligible = state.jobs.filter(
              (job) => job.tenant_id === args.where.tenant_id,
            );
            return eligible.slice(0, args.take ?? eligible.length).map((j) => ({
              id: j.id,
            }));
          },
        ),
      },
    };
  }

  it('never targets jobs still applying in the eligibility filter', () => {
    const where = eligibleImportJobsForRowPurgeWhere(
      tenantA,
      importJobRowRetentionCutoff(now),
    );
    expect(where.status).toEqual({ not: ImportJobStatus.APPLYING });
  });

  it('scopes deletes to the requested tenant', async () => {
    const prisma = makePrisma({
      jobs: [
        { id: 'job-a', tenant_id: tenantA },
        { id: 'job-b', tenant_id: tenantB },
      ],
      rowsByJob: { 'job-a': [1], 'job-b': [1, 2] },
    });

    await purgeStaleImportJobRowsForTenant(prisma as never, tenantA, now);

    expect(prisma.importJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: tenantA }),
      }),
    );
    expect(prisma.importJobRow.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.importJobRow.deleteMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantA,
        import_job_id: 'job-a',
        row_no: { in: [1] },
      },
    });
  });

  it('counts rows without deleting when dry-run is enabled', async () => {
    const prisma = makePrisma({
      jobs: [{ id: 'job-a', tenant_id: tenantA }],
      rowsByJob: { 'job-a': [1, 2, 3] },
    });

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      tenantA,
      now,
      { dryRun: true, rowBatchSize: 2 },
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 3,
      dry_run: true,
    });
    expect(prisma.importJobRow.deleteMany).not.toHaveBeenCalled();
  });
});
