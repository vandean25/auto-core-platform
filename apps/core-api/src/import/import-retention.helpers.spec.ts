import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import {
  IMPORT_FAILED_JOB_ROW_RETENTION_DAYS,
  IMPORT_JOB_RETENTION_DAYS,
  IMPORT_UPLOAD_RETENTION_DAYS,
} from './import.constants.js';
import {
  eligibleImportJobsForRowPurgeWhere,
  fetchEligiblePurgeJobs,
  importJobRowPurgeCutoffs,
  isImportJobEligibleForRowPurge,
  markPurgeCompleted,
  purgeStaleImportJobRowsForTenant,
} from './import-retention.helpers.js';
import {
  createImportRetentionPrismaFake,
  matchesJobUpdateWhere,
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
          status: ImportJobStatus.DRY_RUN_DONE,
          updatedAt: { lt: cutoffs.dryRunCutoff },
        },
        {
          status: ImportJobStatus.CANCELLED,
          OR: [
            {
              OR: [
                { cancelled_at: { lt: cutoffs.appliedCutoff } },
                {
                  cancelled_at: null,
                  createdAt: { lt: cutoffs.appliedCutoff },
                },
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
    const freshDryRunCreatedAt = new Date(
      cutoffs.dryRunCutoff.getTime() + 1000,
    );

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

  it('uses updatedAt over createdAt for DRY_RUN_DONE jobs', () => {
    const staleDate = new Date(cutoffs.dryRunCutoff.getTime() - 1);
    const freshDate = new Date(cutoffs.dryRunCutoff.getTime() + 1000);

    // Old createdAt, but fresh updatedAt: NOT eligible
    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: staleDate,
          updatedAt: freshDate,
        },
        cutoffs,
      ),
    ).toBe(false);

    // Old updatedAt: IS eligible
    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: new Date('2020-01-01'),
          updatedAt: staleDate,
        },
        cutoffs,
      ),
    ).toBe(true);
  });

  it('excludes FAILED jobs with worker phase "apply" unless older than appliedCutoff (180d)', () => {
    const staleFailedAt = new Date(cutoffs.failedCutoff.getTime() - 1);
    const ancientFailedAt = new Date(cutoffs.appliedCutoff.getTime() - 1);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          options_json: { worker: { phase: 'dry_run' } },
        },
        cutoffs,
      ),
    ).toBe(true);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          options_json: { worker: { phase: 'apply' } },
        },
        cutoffs,
      ),
    ).toBe(false);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: ancientFailedAt,
          options_json: { worker: { phase: 'apply' } },
        },
        cutoffs,
      ),
    ).toBe(true);
  });

  it('excludes jobs already marked rows_purged unless older than appliedCutoff (180d)', () => {
    const staleFailedAt = new Date(cutoffs.failedCutoff.getTime() - 1);
    const ancientFailedAt = new Date(cutoffs.appliedCutoff.getTime() - 1);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          options_json: { rows_purged: true },
        },
        cutoffs,
      ),
    ).toBe(false);

    expect(
      isImportJobEligibleForRowPurge(
        {
          status: ImportJobStatus.FAILED,
          failed_at: ancientFailedAt,
          options_json: { rows_purged: true },
        },
        cutoffs,
      ),
    ).toBe(true);
  });
});

describe('purgeStaleImportJobRowsForTenant', () => {
  const cutoffs = importJobRowPurgeCutoffs(NOW);
  const staleAppliedAt = new Date(cutoffs.appliedCutoff.getTime() - 60_000);
  const onCutoffAppliedAt = new Date(cutoffs.appliedCutoff.getTime());
  const staleCancelledAt = new Date(cutoffs.failedCutoff.getTime() - 60_000);
  const staleFailedAt = new Date(cutoffs.failedCutoff.getTime() - 60_000);
  const staleDryRunCreatedAt = new Date(
    cutoffs.dryRunCutoff.getTime() - 60_000,
  );
  const freshDryRunCreatedAt = new Date(
    cutoffs.dryRunCutoff.getTime() + 60_000,
  );
  const freshFailedAt = new Date(cutoffs.failedCutoff.getTime() + 60_000);

  it('purges stale applied rows and issues the expected where clause', async () => {
    const { prisma, rowsByJob, expectedJobWhere } =
      createImportRetentionPrismaFake(
        [
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
            id: 'job-applying',
            tenant_id: TENANT_A,
            status: ImportJobStatus.APPLYING,
            appliedAt: null,
            createdAt: new Date('2020-01-01'),
          },
        ],
        {
          'job-stale-applied': [1, 2],
          'job-on-cutoff': [1],
          'job-applying': [1],
        },
        cutoffs,
      );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(prisma.importJob.findMany).toHaveBeenCalledWith({
      where: expectedJobWhere(TENANT_A),
      select: expect.objectContaining({ id: true }),
      orderBy: { createdAt: 'asc' },
      skip: 0,
      take: 25,
    });
    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 2,
      dry_run: false,
    });
    expect(rowsByJob.get('job-stale-applied')).toEqual([]);
    expect(rowsByJob.get('job-on-cutoff')).toEqual([
      { row_no: 1, action: ImportRowAction.CREATE },
    ]);
    expect(rowsByJob.get('job-applying')).toEqual([
      { row_no: 1, action: ImportRowAction.CREATE },
    ]);
  });

  it('purges staged rows for CANCELLED jobs older than 1-day grace period', async () => {
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-cancelled-stale',
          tenant_id: TENANT_A,
          status: ImportJobStatus.CANCELLED,
          cancelled_at: staleCancelledAt,
          createdAt: new Date('2020-01-01'),
        },
        {
          id: 'job-cancelled-fresh',
          tenant_id: TENANT_A,
          status: ImportJobStatus.CANCELLED,
          cancelled_at: new Date(cutoffs.failedCutoff.getTime() + 60_000),
          createdAt: new Date('2020-01-01'),
        },
      ],
      {
        'job-cancelled-stale': [1, 2, 3],
        'job-cancelled-fresh': [1, 2],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 3,
      dry_run: false,
    });
    expect(rowsByJob.get('job-cancelled-stale')).toEqual([]);
    expect(rowsByJob.get('job-cancelled-fresh')).toHaveLength(2);
  });

  it('expires stale DRY_RUN_DONE jobs (>7d): moves to CANCELLED (cancel_reason: expired) and purges rows', async () => {
    const { prisma, jobs, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-stale-dry-run',
          tenant_id: TENANT_A,
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: staleDryRunCreatedAt,
          options_json: { update_existing: true },
        },
        {
          id: 'job-fresh-dry-run',
          tenant_id: TENANT_A,
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: freshDryRunCreatedAt,
          options_json: { update_existing: false },
        },
      ],
      {
        'job-stale-dry-run': [1, 2, 3, 4],
        'job-fresh-dry-run': [10, 20],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 4,
      dry_run: false,
    });
    // Stale dry run job moved to CANCELLED with cancel_reason: 'expired'
    const staleJob = jobs.find((j) => j.id === 'job-stale-dry-run');
    expect(staleJob?.status).toBe(ImportJobStatus.CANCELLED);
    expect(staleJob?.options_json).toEqual(
      expect.objectContaining({
        update_existing: true,
        cancel_reason: 'expired',
      }),
    );
    expect(staleJob?.cancelled_at).toEqual(NOW);
    expect(rowsByJob.get('job-stale-dry-run')).toEqual([]);

    // Fresh dry run remains untouched
    const freshJob = jobs.find((j) => j.id === 'job-fresh-dry-run');
    expect(freshJob?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    expect(rowsByJob.get('job-fresh-dry-run')).toHaveLength(2);
  });

  it('purges staged rows for FAILED jobs (>1d): keeps ERROR rows when totals.error > 0 and deletes non-error rows', async () => {
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-failed-with-errors',
          tenant_id: TENANT_A,
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          createdAt: new Date('2020-01-01'),
          totals_json: { rows: 5, create: 3, update: 0, skip: 0, error: 2 },
        },
      ],
      {
        'job-failed-with-errors': [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
          { row_no: 3, action: ImportRowAction.CREATE },
          { row_no: 4, action: ImportRowAction.ERROR },
          { row_no: 5, action: ImportRowAction.CREATE },
        ],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 3,
      dry_run: false,
    });
    // Non-error rows deleted, ERROR rows kept for errors.csv
    const remaining = rowsByJob.get('job-failed-with-errors') ?? [];
    expect(remaining).toEqual([
      { row_no: 2, action: ImportRowAction.ERROR },
      { row_no: 4, action: ImportRowAction.ERROR },
    ]);
  });

  it('purges all rows for FAILED jobs (>1d) when totals.error is 0', async () => {
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-failed-no-errors',
          tenant_id: TENANT_A,
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          createdAt: new Date('2020-01-01'),
          totals_json: { rows: 2, create: 2, update: 0, skip: 0, error: 0 },
        },
      ],
      {
        'job-failed-no-errors': [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.CREATE },
        ],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 2,
      dry_run: false,
    });
    expect(rowsByJob.get('job-failed-no-errors')).toEqual([]);
  });

  it('purges all rows including ERROR rows for FAILED jobs older than 180 days', async () => {
    const ancientFailedAt = new Date(cutoffs.appliedCutoff.getTime() - 60_000);
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-failed-ancient',
          tenant_id: TENANT_A,
          status: ImportJobStatus.FAILED,
          failed_at: ancientFailedAt,
          createdAt: new Date('2020-01-01'),
          totals_json: { rows: 2, create: 1, update: 0, skip: 0, error: 1 },
        },
      ],
      {
        'job-failed-ancient': [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
        ],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result).toEqual({
      jobs_scanned: 1,
      rows_deleted: 2,
      dry_run: false,
    });
    expect(rowsByJob.get('job-failed-ancient')).toEqual([]);
  });

  it('preserves tenant isolation: never purges rows or transitions jobs belonging to another tenant', async () => {
    const { prisma, jobs, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-tenant-b-stale-dry-run',
          tenant_id: TENANT_B,
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: staleDryRunCreatedAt,
        },
        {
          id: 'job-tenant-b-stale-failed',
          tenant_id: TENANT_B,
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          createdAt: new Date('2020-01-01'),
        },
      ],
      {
        'job-tenant-b-stale-dry-run': [1, 2],
        'job-tenant-b-stale-failed': [1],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result).toEqual({
      jobs_scanned: 0,
      rows_deleted: 0,
      dry_run: false,
    });
    // Tenant B's jobs stay completely untouched
    expect(jobs[0].status).toBe(ImportJobStatus.DRY_RUN_DONE);
    expect(rowsByJob.get('job-tenant-b-stale-dry-run')).toHaveLength(2);
    expect(rowsByJob.get('job-tenant-b-stale-failed')).toHaveLength(1);
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
      cutoffs,
    );

    await purgeStaleImportJobRowsForTenant(prisma as never, TENANT_A, NOW, {
      rowBatchSize: 2,
    });

    expect(prisma.importJobRow.deleteMany).toHaveBeenCalledTimes(3);
    expect(
      prisma.importJobRow.deleteMany.mock.calls[0][0].where.row_no.in,
    ).toEqual([1, 2]);
    expect(
      prisma.importJobRow.deleteMany.mock.calls[1][0].where.row_no.in,
    ).toEqual([3, 4]);
    expect(
      prisma.importJobRow.deleteMany.mock.calls[2][0].where.row_no.in,
    ).toEqual([5]);
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
      cutoffs,
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
    expect(rowsByJob.get('job-stale-applied')).toHaveLength(3);
    expect(prisma.importJobRow.deleteMany).not.toHaveBeenCalled();
  });

  it('emits an auditLog event when expiring a DRY_RUN_DONE job', async () => {
    const { prisma } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-stale-dry-run-audit',
          tenant_id: TENANT_A,
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: staleDryRunCreatedAt,
        },
      ],
      { 'job-stale-dry-run-audit': [1] },
      cutoffs,
    );

    await purgeStaleImportJobRowsForTenant(prisma as never, TENANT_A, NOW);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: TENANT_A,
        entity_type: 'ImportJob',
        entity_id: 'job-stale-dry-run-audit',
        after: expect.objectContaining({
          event: 'import_job.expired',
        }),
      }),
    });
  });

  it('marks options_json.rows_purged = true on FAILED jobs after purging rows', async () => {
    const { prisma, jobs } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-failed-mark-purged',
          tenant_id: TENANT_A,
          status: ImportJobStatus.FAILED,
          failed_at: staleFailedAt,
          createdAt: new Date('2020-01-01'),
          totals_json: { rows: 2, create: 1, update: 0, skip: 0, error: 1 },
          options_json: { existing_opt: true },
        },
      ],
      {
        'job-failed-mark-purged': [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
        ],
      },
      cutoffs,
    );

    await purgeStaleImportJobRowsForTenant(prisma as never, TENANT_A, NOW);

    const job = jobs.find((j) => j.id === 'job-failed-mark-purged');
    expect(job?.options_json).toEqual(
      expect.objectContaining({
        existing_opt: true,
        rows_purged: true,
      }),
    );
  });

  it('halts row purging and does not purge rows if status changed concurrently (updateMany returns count 0)', async () => {
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-race',
          tenant_id: TENANT_A,
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: staleDryRunCreatedAt,
        },
      ],
      { 'job-race': [1, 2] },
      cutoffs,
    );

    // Simulate concurrent update before purge: updateMany returns 0
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValueOnce({
      count: 0,
    });

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
    );

    expect(result.rows_deleted).toBe(0);
    expect(rowsByJob.get('job-race')).toHaveLength(2);
  });

  it('stops processing further jobs once rowBudget is reached', async () => {
    const { prisma, rowsByJob } = createImportRetentionPrismaFake(
      [
        {
          id: 'job-1',
          tenant_id: TENANT_A,
          status: ImportJobStatus.APPLIED,
          appliedAt: staleAppliedAt,
          createdAt: new Date('2020-01-01'),
        },
        {
          id: 'job-2',
          tenant_id: TENANT_A,
          status: ImportJobStatus.APPLIED,
          appliedAt: staleAppliedAt,
          createdAt: new Date('2020-01-02'),
        },
      ],
      {
        'job-1': [1, 2, 3],
        'job-2': [4, 5, 6],
      },
      cutoffs,
    );

    const result = await purgeStaleImportJobRowsForTenant(
      prisma as never,
      TENANT_A,
      NOW,
      { rowBudget: 3 },
    );

    expect(result.rows_deleted).toBe(3);
    expect(rowsByJob.get('job-1')).toEqual([]);
    expect(rowsByJob.get('job-2')).toHaveLength(3);
  });

  describe('matchesJobUpdateWhere', () => {
    const baseJob: RetentionTestJob = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.FAILED,
      createdAt: new Date(),
      options_json: { rows_purged: true },
    };

    it('matches matching tenant and id', () => {
      expect(
        matchesJobUpdateWhere(baseJob, { tenant_id: 'tenant-1', id: 'job-1' }),
      ).toBe(true);
      expect(
        matchesJobUpdateWhere(baseJob, {
          tenant_id: 'tenant-other',
          id: 'job-1',
        }),
      ).toBe(false);
      expect(
        matchesJobUpdateWhere(baseJob, {
          tenant_id: 'tenant-1',
          id: 'job-other',
        }),
      ).toBe(false);
    });

    it('matches status filter', () => {
      expect(
        matchesJobUpdateWhere(baseJob, { status: ImportJobStatus.FAILED }),
      ).toBe(true);
      expect(
        matchesJobUpdateWhere(baseJob, { status: ImportJobStatus.APPLIED }),
      ).toBe(false);
    });

    it('rejects jobs matching NOT rows_purged: true', () => {
      expect(
        matchesJobUpdateWhere(baseJob, {
          NOT: { options_json: { path: ['rows_purged'], equals: true } },
        }),
      ).toBe(false);

      const unpurgedJob = { ...baseJob, options_json: { rows_purged: false } };
      expect(
        matchesJobUpdateWhere(unpurgedJob, {
          NOT: { options_json: { path: ['rows_purged'], equals: true } },
        }),
      ).toBe(true);

      const otherPathJob = { ...baseJob, options_json: { other: true } };
      expect(
        matchesJobUpdateWhere(otherPathJob, {
          NOT: { options_json: { path: ['other_path'], equals: true } },
        }),
      ).toBe(true);
    });
  });

  describe('Paging and budget continuation', () => {
    const cutoffs = importJobRowPurgeCutoffs(NOW);

    it('pages past skipped apply-phase FAILED jobs to find eligible jobs without starvation', async () => {
      // 26 apply-phase FAILED jobs (ineligible for 1d purge)
      const skippedJobs: RetentionTestJob[] = Array.from(
        { length: 26 },
        (_, i) => ({
          id: `job-apply-failed-${i}`,
          tenant_id: TENANT_A,
          status: ImportJobStatus.FAILED,
          failed_at: new Date(cutoffs.failedCutoff.getTime() - 1000 * (i + 2)),
          createdAt: new Date(NOW.getTime() - 1000 * (i + 100)),
          options_json: { worker: { phase: 'apply' } },
        }),
      );
      // 1 eligible dry-run FAILED job
      const eligibleJob: RetentionTestJob = {
        id: 'job-dry-run-failed-eligible',
        tenant_id: TENANT_A,
        status: ImportJobStatus.FAILED,
        failed_at: new Date(cutoffs.failedCutoff.getTime() - 500),
        createdAt: new Date(NOW.getTime() - 10),
        options_json: { worker: { phase: 'dry_run' } },
      };

      const rowsByJob: Record<
        string,
        Array<{ row_no: number; action: ImportRowAction }>
      > = {
        'job-dry-run-failed-eligible': [
          { row_no: 1, action: ImportRowAction.CREATE },
        ],
      };
      for (const j of skippedJobs) {
        rowsByJob[j.id] = [{ row_no: 1, action: ImportRowAction.CREATE }];
      }

      const { prisma, jobs } = createImportRetentionPrismaFake(
        [...skippedJobs, eligibleJob],
        rowsByJob,
        cutoffs,
      );

      const result = await purgeStaleImportJobRowsForTenant(
        prisma as never,
        TENANT_A,
        NOW,
        { jobsPerTenant: 25 },
      );

      expect(result.jobs_scanned).toBe(1);
      expect(result.rows_deleted).toBe(1);
      const purged = jobs.find((j) => j.id === 'job-dry-run-failed-eligible');
      expect(
        (purged?.options_json as Record<string, unknown>)?.rows_purged,
      ).toBe(true);
      expect(
        (purged?.options_json as Record<string, unknown>)?.rows_purge_completed,
      ).toBe(true);
    });

    it('continues half-purged jobs on subsequent runs when budget truncated', async () => {
      const job: RetentionTestJob = {
        id: 'job-large-failed',
        tenant_id: TENANT_A,
        status: ImportJobStatus.FAILED,
        failed_at: new Date(cutoffs.failedCutoff.getTime() - 10000),
        createdAt: new Date(NOW.getTime() - 20000),
        options_json: { worker: { phase: 'dry_run' } },
      };
      const rows = [
        { row_no: 1, action: ImportRowAction.CREATE },
        { row_no: 2, action: ImportRowAction.CREATE },
        { row_no: 3, action: ImportRowAction.CREATE },
        { row_no: 4, action: ImportRowAction.CREATE },
        { row_no: 5, action: ImportRowAction.CREATE },
      ];

      const { prisma, jobs, rowsByJob } = createImportRetentionPrismaFake(
        [job],
        { 'job-large-failed': rows },
        cutoffs,
      );

      // Run 1 with rowBudget = 2
      const run1 = await purgeStaleImportJobRowsForTenant(
        prisma as never,
        TENANT_A,
        NOW,
        { rowBudget: 2 },
      );

      expect(run1.rows_deleted).toBe(2);
      expect(rowsByJob.get('job-large-failed')?.length).toBe(3);
      const jobAfterRun1 = jobs.find((j) => j.id === 'job-large-failed');
      const opts1 = jobAfterRun1?.options_json as Record<string, unknown>;
      expect(opts1.rows_purged).toBe(true);
      expect(opts1.rows_purge_completed).toBe(false);

      // Run 2 continues and purges remaining rows
      const run2 = await purgeStaleImportJobRowsForTenant(
        prisma as never,
        TENANT_A,
        NOW,
        { rowBudget: 10 },
      );

      expect(run2.rows_deleted).toBe(3);
      expect(rowsByJob.get('job-large-failed')?.length).toBe(0);
      const jobAfterRun2 = jobs.find((j) => j.id === 'job-large-failed');
      const opts2 = jobAfterRun2?.options_json as Record<string, unknown>;
      expect(opts2.rows_purged).toBe(true);
      expect(opts2.rows_purge_completed).toBe(true);
    });

    it('logs a warning and continues if audit log creation fails', async () => {
      const job: RetentionTestJob = {
        id: 'job-audit-fail',
        tenant_id: TENANT_A,
        status: ImportJobStatus.FAILED,
        failed_at: new Date(cutoffs.failedCutoff.getTime() - 10000),
        createdAt: new Date(NOW.getTime() - 20000),
        options_json: { worker: { phase: 'dry_run' } },
      };

      const { prisma } = createImportRetentionPrismaFake(
        [job],
        { 'job-audit-fail': [{ row_no: 1, action: ImportRowAction.CREATE }] },
        cutoffs,
      );

      prisma.auditLog.create.mockRejectedValueOnce(new Error('Audit DB down'));
      const warnMock = jest.fn();

      const result = await purgeStaleImportJobRowsForTenant(
        prisma as never,
        TENANT_A,
        NOW,
        { logger: { warn: warnMock } },
      );

      expect(result.rows_deleted).toBe(1);
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to record audit log for import_job.purged',
        ),
      );
    });
  });

  describe('markPurgeCompleted', () => {
    it('merges existing options and preserves existing keys when marking purge completed', async () => {
      const existingOptions = {
        worker: { phase: 'dry_run', lease_token: 'lease-1' },
        custom_setting: 'preserve_this_value',
        mapping: { colA: 'fieldA' },
        rows_purged: true,
        rows_purge_completed: false,
      };
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const prisma = {
        importJob: {
          findFirst: jest.fn(async () => ({
            options_json: existingOptions,
          })),
          updateMany,
        },
      };

      await markPurgeCompleted(
        prisma as never,
        TENANT_A,
        'job-complete-1',
        ImportJobStatus.FAILED,
      );

      expect(prisma.importJob.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_A, id: 'job-complete-1' },
        select: { options_json: true },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_A,
          id: 'job-complete-1',
          status: ImportJobStatus.FAILED,
        },
        data: {
          updatedAt: expect.any(Date),
          options_json: {
            worker: { phase: 'dry_run', lease_token: 'lease-1' },
            custom_setting: 'preserve_this_value',
            mapping: { colA: 'fieldA' },
            rows_purged: true,
            rows_purge_completed: true,
          },
        },
      });
    });
  });

  describe('fetchEligiblePurgeJobs candidate scanning cap', () => {
    it('stops scanning candidate jobs once maxCandidatesScanned is reached', async () => {
      const cutoffs = importJobRowPurgeCutoffs(NOW);
      const findMany = jest.fn(
        async ({ skip, take }: { skip: number; take: number }) => {
          return Array.from({ length: take }, (_, idx) => ({
            id: `job-ineligible-${skip + idx}`,
            status: ImportJobStatus.FAILED,
            options_json: { worker: { phase: 'apply' } },
            totals_json: null,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
            failed_at: new Date('2026-01-01'),
            cancelled_at: null,
            appliedAt: null,
          }));
        },
      );
      const prisma = {
        importJob: { findMany },
      };

      const jobs = await fetchEligiblePurgeJobs(
        prisma as never,
        TENANT_A,
        cutoffs,
        25,
        50,
      );

      expect(jobs).toEqual([]);
      expect(findMany).toHaveBeenCalledTimes(2);
      expect(findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ skip: 0, take: 25 }),
      );
      expect(findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ skip: 25, take: 25 }),
      );
    });
  });
});
