import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';
import {
  importJobRowPurgeCutoffs,
  importJobRowRetentionCutoff,
} from './import-retention.helpers.js';
import { ImportRetentionService } from './import-retention.service.js';
import { createImportRetentionPrismaFake } from './import-retention.spec.support.js';

describe('ImportRetentionService', () => {
  const tenantId = 'tenant-retention';
  const now = new Date('2026-06-01T12:00:00.000Z');
  const cutoffs = importJobRowPurgeCutoffs(now);
  const staleAppliedAt = new Date(cutoffs.appliedCutoff.getTime() - 1);
  const staleDryRunCreatedAt = new Date(cutoffs.dryRunCutoff.getTime() - 1);
  const freshDryRunCreatedAt = new Date(cutoffs.dryRunCutoff.getTime() + 60_000);
  const staleFailedAt = new Date(cutoffs.failedCutoff.getTime() - 1);

  it('purgeForTenant purges stale rows across applied, cancelled, failed, and expired dry runs while keeping fresh dry runs untouched', async () => {
    const { prisma, jobs, rowsByJob, expectedJobWhere } =
      createImportRetentionPrismaFake(
        [
          {
            id: 'job-applied',
            tenant_id: tenantId,
            status: ImportJobStatus.APPLIED,
            appliedAt: staleAppliedAt,
            createdAt: new Date('2020-01-01'),
          },
          {
            id: 'job-stale-dry-run',
            tenant_id: tenantId,
            status: ImportJobStatus.DRY_RUN_DONE,
            createdAt: staleDryRunCreatedAt,
          },
          {
            id: 'job-fresh-dry-run',
            tenant_id: tenantId,
            status: ImportJobStatus.DRY_RUN_DONE,
            createdAt: freshDryRunCreatedAt,
          },
          {
            id: 'job-failed',
            tenant_id: tenantId,
            status: ImportJobStatus.FAILED,
            failed_at: staleFailedAt,
            createdAt: new Date('2020-01-01'),
            totals_json: { rows: 3, create: 2, update: 0, skip: 0, error: 1 },
          },
        ],
        {
          'job-applied': [10],
          'job-stale-dry-run': [20, 21],
          'job-fresh-dry-run': [30],
          'job-failed': [
            { row_no: 1, action: ImportRowAction.CREATE },
            { row_no: 2, action: ImportRowAction.CREATE },
            { row_no: 3, action: ImportRowAction.ERROR },
          ],
        },
        cutoffs,
      );

    const service = new ImportRetentionService(
      prisma as never,
      { tenant: { findMany: jest.fn() }, ...cronJobLockTestStub() } as never,
      { runAsWorker: jest.fn() } as never,
    );

    const counts = await service.purgeForTenant(tenantId, now);

    expect(prisma.importJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedJobWhere(tenantId) }),
    );
    expect(counts).toEqual({
      jobs_scanned: 3, // applied, stale dry run, failed
      rows_deleted: 5, // 1 applied + 2 stale dry run + 2 non-error failed
      dry_run: false,
    });
    // Stale applied rows purged
    expect(rowsByJob.get('job-applied')).toEqual([]);
    // Stale dry run transitioned to CANCELLED and rows purged
    const staleDryRun = jobs.find((j) => j.id === 'job-stale-dry-run');
    expect(staleDryRun?.status).toBe(ImportJobStatus.CANCELLED);
    expect(rowsByJob.get('job-stale-dry-run')).toEqual([]);
    // Fresh dry run untouched
    const freshDryRun = jobs.find((j) => j.id === 'job-fresh-dry-run');
    expect(freshDryRun?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    expect(rowsByJob.get('job-fresh-dry-run')).toHaveLength(1);
    // Failed job: error row preserved, non-error rows purged
    expect(rowsByJob.get('job-failed')).toEqual([
      { row_no: 3, action: ImportRowAction.ERROR },
    ]);
  });
});
