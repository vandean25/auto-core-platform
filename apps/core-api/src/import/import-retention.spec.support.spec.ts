import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import {
  createImportRetentionPrismaFake,
  rowMatchesAction,
} from './import-retention.spec.support.js';

describe('import-retention.spec.support', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  describe('rowMatchesAction', () => {
    it('returns true when actionFilter is undefined', () => {
      expect(
        rowMatchesAction({ row_no: 1, action: ImportRowAction.CREATE }),
      ).toBe(true);
    });

    it('matches exact string action', () => {
      const row = { row_no: 1, action: ImportRowAction.ERROR };
      expect(rowMatchesAction(row, ImportRowAction.ERROR)).toBe(true);
      expect(rowMatchesAction(row, ImportRowAction.CREATE)).toBe(false);
    });

    it('defaults undefined row action to CREATE when matching string', () => {
      const row = { row_no: 1 };
      expect(rowMatchesAction(row, ImportRowAction.CREATE)).toBe(true);
      expect(rowMatchesAction(row, ImportRowAction.ERROR)).toBe(false);
    });

    it('matches object filter with not', () => {
      const errorRow = { row_no: 1, action: ImportRowAction.ERROR };
      const createRow = { row_no: 2, action: ImportRowAction.CREATE };

      expect(
        rowMatchesAction(errorRow, { not: ImportRowAction.ERROR }),
      ).toBe(false);
      expect(
        rowMatchesAction(createRow, { not: ImportRowAction.ERROR }),
      ).toBe(true);
    });

    it('matches object filter with in array', () => {
      const errorRow = { row_no: 1, action: ImportRowAction.ERROR };
      const createRow = { row_no: 2, action: ImportRowAction.CREATE };
      const inFilter = { in: [ImportRowAction.ERROR] };

      expect(rowMatchesAction(errorRow, inFilter)).toBe(true);
      expect(rowMatchesAction(createRow, inFilter)).toBe(false);
    });

    it('returns true for other object filter shapes', () => {
      const row = { row_no: 1, action: ImportRowAction.CREATE };
      expect(rowMatchesAction(row, {})).toBe(true);
    });
  });

  describe('createImportRetentionPrismaFake', () => {
    it('updates matching jobs in updateMany and filters non-matching jobs', async () => {
      const { prisma, jobs } = createImportRetentionPrismaFake(
        [
          {
            id: 'job-1',
            tenant_id: 'tenant-a',
            status: ImportJobStatus.DRY_RUN_DONE,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            id: 'job-2',
            tenant_id: 'tenant-b',
            status: ImportJobStatus.DRY_RUN_DONE,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        { 'job-1': [1], 'job-2': [2] },
        now,
      );

      // Mismatch tenant_id
      const resMismatchTenant = await prisma.importJob.updateMany({
        where: { tenant_id: 'tenant-other', id: 'job-1' },
        data: { status: ImportJobStatus.CANCELLED },
      });
      expect(resMismatchTenant.count).toBe(0);

      // Mismatch id
      const resMismatchId = await prisma.importJob.updateMany({
        where: { tenant_id: 'tenant-a', id: 'job-other' },
        data: { status: ImportJobStatus.CANCELLED },
      });
      expect(resMismatchId.count).toBe(0);

      // Mismatch status
      const resMismatchStatus = await prisma.importJob.updateMany({
        where: {
          tenant_id: 'tenant-a',
          id: 'job-1',
          status: ImportJobStatus.APPLIED,
        },
        data: { status: ImportJobStatus.CANCELLED },
      });
      expect(resMismatchStatus.count).toBe(0);

      // Matching update
      const resMatch = await prisma.importJob.updateMany({
        where: {
          tenant_id: 'tenant-a',
          id: 'job-1',
          status: ImportJobStatus.DRY_RUN_DONE,
        },
        data: {
          status: ImportJobStatus.CANCELLED,
          cancelled_at: now,
          options_json: { cancel_reason: 'expired' },
        },
      });
      expect(resMatch.count).toBe(1);
      expect(jobs[0].status).toBe(ImportJobStatus.CANCELLED);
      expect(jobs[0].cancelled_at).toEqual(now);
      expect(jobs[0].options_json).toEqual({ cancel_reason: 'expired' });
    });

    it('rejects forbidden operations', async () => {
      const { prisma } = createImportRetentionPrismaFake([], {}, now);

      await expect(prisma.importJob.deleteMany()).rejects.toThrow(
        'import_jobs must not be deleted during row purge',
      );
      await expect(
        prisma.externalIdMapping.updateMany(),
      ).rejects.toThrow(
        'external_id_mappings must not be updated during row purge',
      );
      await expect(
        prisma.externalIdMapping.deleteMany(),
      ).rejects.toThrow(
        'external_id_mappings must not be deleted during row purge',
      );
    });
  });
});
