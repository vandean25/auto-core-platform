import { ImportJobStatus } from '@prisma/client';
import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';
import { IMPORT_JOB_RETENTION_DAYS } from './import.constants.js';
import { importJobRowRetentionCutoff } from './import-retention.helpers.js';
import { ImportRetentionService } from './import-retention.service.js';
import { createImportRetentionPrismaFake } from './import-retention.spec.support.js';

describe('ImportRetentionService', () => {
  const tenantId = 'tenant-retention';
  const now = new Date('2026-06-01T12:00:00.000Z');
  const cutoff = importJobRowRetentionCutoff(now, IMPORT_JOB_RETENTION_DAYS);
  const staleAppliedAt = new Date(cutoff.getTime() - 1);

  it('purgeForTenant runs the same bounded row purge without touching headers or mappings', async () => {
    const { prisma, rowsByJob, expectedJobWhere } =
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
            id: 'job-dry-run',
            tenant_id: tenantId,
            status: ImportJobStatus.DRY_RUN_DONE,
            appliedAt: null,
            createdAt: new Date('2020-01-01'),
          },
        ],
        { 'job-applied': [10], 'job-dry-run': [20] },
        cutoff,
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
      jobs_scanned: 1,
      rows_deleted: 1,
      dry_run: false,
    });
    expect(rowsByJob.get('job-applied')).toEqual([]);
    expect(rowsByJob.get('job-dry-run')).toEqual([20]);
    expect(prisma.importJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.externalIdMapping.deleteMany).not.toHaveBeenCalled();
  });
});
