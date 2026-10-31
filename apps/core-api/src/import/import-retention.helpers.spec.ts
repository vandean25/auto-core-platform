import { ImportJobStatus } from '@prisma/client';
import {
  IMPORT_FAILED_JOB_ROW_RETENTION_DAYS,
  IMPORT_JOB_RETENTION_DAYS,
  IMPORT_UPLOAD_RETENTION_DAYS,
} from './import.constants.js';
import {
  eligibleImportJobsForRowPurgeWhere,
  importJobRowPurgeCutoffs,
  importJobRowRetentionCutoff,
  isImportJobEligibleForRowPurge,
  purgeStaleImportJobRowsForTenant,
} from './import-retention.helpers.js';
import {
  createImportRetentionPrismaFake,
  type RetentionTestJob,
} from './import-retention.spec.support.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('importJobRowPurgeCutoffs', () => {
  it('computes applied (180d), failed/cancelled (1d), and dry-run (7d) cutoffs', () => {
    const cutoffs = importJobRowPurgeCutoffs(NOW);
    expect(cutoffs.appliedCutoff).toEqual(
      new Date(NOW.getTime() - IMPORT_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
    expect(cutoffs.failedCutoff).toEqual(
      new Date(
        NOW.getTime() -
          IMPORT_FAILED_JOB_ROW_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
    );
    expect(cutoffs.dryRunCutoff).toEqual(
      new Date(
        NOW.getTime() - IMPORT_UPLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
    );
  });
});

describe('eligibleImportJobsForRowPurgeWhere', () => {
  const cutoffs = importJobRowPurgeCutoffs(NOW);

  it('targets applied (180d), cancelled (1d), failed (1d), and stale dry runs (7d)', () => {
    expect(eligibleImportJobsForRowPurgeWhere(TENANT_A, cutoffs)).toEqual({
      tenant_id: TENANT_A,
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
    });
  });
});

describe('isImportJobEligibleForRowPurge', () => {
  const cutoffs = importJobRowPurgeCutoffs(NOW);

  it('keeps applied jobs on the cutoff instant and purges only strictly older applied jobs', () => {
    const onBoundary = new Date(cutoffs.appliedCutoff.getTime());
    const beforeBoundary = new Date(cutoffs.appliedCutoff.getTime() - 1);

    expect(
      isImportJobEligibleForRowPurge(
        { status: ImportJobStatus.APPLIED, appliedAt: onBoundary },
        cutoffs,
      ),
    ).toBe(false);

    expect(
      isImportJobEligibleForRowPurge(
        { status: ImportJobStatus.APPLIED, appliedAt: beforeBoundary },
        cutoffs,
      ),
    ).toBe(true);
  });

  it('evaluates FAILED jobs against the 1-day failedCutoff using failed_at or fallback createdAt', () => {
    const staleFailedAt = new Date(cutoffs.failedCutoff.getTime() - 1);
    const freshFailedAt = new Date(cutoffs.failedCutoff.getTime() + 1000);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          createdAt: new Date('2020-01-01'),
        },
        cutoffs,
      ),
    ).toBe(true);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: freshFailedAt,
          createdAt: new Date('2020-01-01'),
        },
        cutoffs,
      ),
    ).toBe(false);

    // Fallback to createdAt when failed_at is null
    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: null,
          createdAt: staleFailedAt,
        },
        cutoffs,
      ),
    ).toBe(true);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: null,
          createdAt: freshFailedAt,
        },
        cutoffs,
      ),
    ).toBe(false);
  });

  it('evaluates CANCELLED jobs against the 1-day failedCutoff using cancelled_at or fallback createdAt', () => {
    const staleCancelledAt = new Date(cutoffs.failedCutoff.getTime() - 1);
    const freshCancelledAt = new Date(cutoffs.failedCutoff.getTime() + 1000);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.CANCELLED,
          cancelled_at: staleCancelledAt,
          createdAt: new Date('2020-01-01'),
        },
        cutoffs,
      ),
    ).toBe(true);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.CANCELLED,
          cancelled_at: freshCancelledAt,
          createdAt: new Date('2020-01-01'),
        },
        cutoffs,
      ),
    ).toBe(false);
  });

  it('evaluates DRY_RUN_DONE jobs against the 7-day dryRunCutoff using createdAt', () => {
    const staleDryRunCreatedAt = new Date(cutoffs.dryRunCutoff.getTime() - 1);
    const freshDryRunCreatedAt = new Date(cutoffs.dryRunCutoff.getTime() + 1000);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: staleDryRunCreatedAt,
        },
        cutoffs,
      ),
    ).toBe(true);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: freshDryRunCreatedAt,
        },
        cutoffs,
      ),
    ).toBe(false);
  });

  it('never treats APPLYING as eligible even when old', () => {
    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.APPLYING,
          createdAt: new Date('2020-01-01'),
        },
        cutoffs,
      ),
    ).toBe(false);
  });
});

describe('purgeStaleImportJobRowsForTenant', () => {
  const cutoff = importJobRowRetentionCutoff(NOW, IMPORT_JOB_RETENTION_DAYS);
  const staleAppliedAt = new Date(cutoff.getTime() - 60_000);
  const onCutoffAppliedAt = new Date(cutoff.getTime());

  function seedJobs(): RetentionTestJob[] {
    return [
      {
        id: 'job-stale-applied',
        tenant_id: TENANT_A,
        status: ImportJobStatus.APPLIED,
        appliedAt: staleAppliedAt,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'job-on-cutoff',
        tenant_id: TENANT_A,
        status: ImportJobStatus.APPLIED,
        appliedAt: onCutoffAppliedAt,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'job-dry-run',
        tenant_id: TENANT_A,
        status: ImportJobStatus.DRY_RUN_DONE,
        appliedAt: null,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'job-applying',
        tenant_id: TENANT_A,
        status: ImportJobStatus.APPLYING,
        appliedAt: null,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'job-failed-recent',
        tenant_id: TENANT_A,
        status: ImportJobStatus.FAILED,
        appliedAt: null,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'job-other-tenant',
        tenant_id: TENANT_B,
        status: ImportJobStatus.APPLIED,
        appliedAt: staleAppliedAt,
        createdAt: new Date('2020-01-01'),
      },
    ];
  }

  it('issues the exact eligibility where-clause and purges only stale applied rows', async () => {
    const { prisma, rowsByJob, expectedJobWhere } =
      createImportRetentionPrismaFake(
        seedJobs(),
        {
          'job-stale-applied': [1, 2],
          'job-on-cutoff': [1],
          'job-dry-run': [1],
          'job-applying': [1],
          'job-failed-recent': [1],
          'job-other-tenant': [1, 2, 3],
        },
        cutoff,
      );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(prisma.importJob.findMany).toHaveBeenCalledWith({
      where: expectedJobWhere(TENANT_A),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 25,
    });
    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 2,
      dry_run: false,
    });
    expect(rowsByJob.get('job-stale-applied')).toEqual([]);
    expect(rowsByJob.get('job-on-cutoff')).toEqual([1]);
    expect(rowsByJob.get('job-dry-run')).toEqual([1]);
    expect(rowsByJob.get('job-applying')).toEqual([1]);
    expect(rowsByJob.get('job-failed-recent')).toEqual([1]);
    expect(rowsByJob.get('job-other-tenant')).toEqual([1, 2, 3]);
    expect(prisma.importJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.importJob.deleteMany).not.toHaveBeenCalled();
    expect(prisma.externalIdMapping.updateMany).not.toHaveBeenCalled();
    expect(prisma.externalIdMapping.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes rows in bounded batches when a job has more rows than the batch size', async () => {
    const { prisma } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-batch',
          tenant_id: TENANT_A,
          status: ImportJobStatus.APPLIED,
          appliedAt: staleAppliedAt,
          createdAt: new Date('2020-01-01'),
        },
      ],
      { 'job-batch': [1, 2, 3, 4, 5] },
      cutoff,
    );

    await purgeStaleImportJobRowsForTenant(prisma as never, TENANT_A, NOW, {
      rowBatchSize: 2,
    });

    expect(prisma.importJobRow.deleteMany).toHaveBeenCalledTimes(3);
    expect(prisma.importJobRow.deleteMany.mock.calls[0][0].where.row_no.in).toEqual(
      [1, 2],
    );
    expect(prisma.importJobRow.deleteMany.mock.calls[1][0].where.row_no.in).toEqual(
      [3, 4],
    );
    expect(prisma.importJobRow.deleteMany.mock.calls[2][0].where.row_no.in).toEqual(
      [5],
    );
  });

  it('counts rows without deleting when dry-run is enabled', async () => {
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-stale-applied',
          tenant_id: TENANT_A,
          status: ImportJobStatus.APPLIED,
          appliedAt: staleAppliedAt,
          createdAt: new Date('2020-01-01'),
        },
      ],
      { 'job-stale-applied': [1, 2, 3] },
      cutoff,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
      { dryRun: true },
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 3,
      dry_run: true,
    });
    expect(rowsByJob.get('job-stale-applied')).toEqual([1, 2, 3]);
    expect(prisma.importJobRow.deleteMany).not.toHaveBeenCalled();
  });
});
