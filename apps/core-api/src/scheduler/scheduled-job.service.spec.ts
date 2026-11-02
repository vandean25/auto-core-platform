import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ScheduledJobService } from './scheduled-job.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

describe('ScheduledJobService', () => {
  let service: ScheduledJobService;
  let mockScheduledJobRun: {
    upsert: jest.MockedFunction<any>;
    updateMany: jest.MockedFunction<any>;
    findUnique: jest.MockedFunction<any>;
  };
  let mockSystemPrisma: SystemPrismaService;

  const now = new Date('2026-11-01T12:00:00.000Z');

  beforeEach(() => {
    mockScheduledJobRun = {
      upsert: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue({ job_name: 'import-job-row-purge' }),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    };
    mockSystemPrisma = {
      scheduledJobRun: mockScheduledJobRun,
    } as unknown as SystemPrismaService;

    service = new ScheduledJobService(mockSystemPrisma);
  });

  describe('tryClaimJob', () => {
    it('ensures row exists via upsert before attempting claim', async () => {
      mockScheduledJobRun.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.tryClaimJob({
        jobName: 'import-job-row-purge',
        now,
      });

      expect(mockScheduledJobRun.upsert).toHaveBeenCalledWith({
        where: { job_name: 'import-job-row-purge' },
        create: { job_name: 'import-job-row-purge' },
        update: {},
      });
      expect(result.claimed).toBe(true);
      if (result.claimed) {
        expect(typeof result.runId).toBe('string');
        expect(result.runId.length).toBeGreaterThan(0);
      }
    });

    it('successfully claims when conditional update affects 1 row', async () => {
      mockScheduledJobRun.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.tryClaimJob({
        jobName: 'import-job-row-purge',
        now,
        intervalMs: 24 * 60 * 60 * 1000,
        leaseMs: 2 * 60 * 60 * 1000,
      });

      expect(result.claimed).toBe(true);
      if (result.claimed) {
        expect(result.runId).toBeDefined();
      }

      const updateCall = mockScheduledJobRun.updateMany.mock.calls[0][0];
      expect(updateCall.where.job_name).toBe('import-job-row-purge');
      expect(updateCall.data.claimed_at).toEqual(now);
      expect(typeof updateCall.data.run_id).toBe('string');

      // Verify CAS cutoffs in where clause
      const intervalCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const leaseCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(updateCall.where.AND).toEqual([
        {
          OR: [{ last_run_at: null }, { last_run_at: { lt: intervalCutoff } }],
        },
        {
          OR: [{ claimed_at: null }, { claimed_at: { lt: leaseCutoff } }],
        },
      ]);
    });

    it('returns claimed: false when conditional update affects 0 rows (already claimed or not due)', async () => {
      mockScheduledJobRun.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.tryClaimJob({
        jobName: 'import-job-row-purge',
        now,
      });

      expect(result.claimed).toBe(false);
    });
  });

  describe('markJobRunCompleted', () => {
    it('sets last_run_at and clears claimed_at for the matching run_id', async () => {
      mockScheduledJobRun.updateMany.mockResolvedValue({ count: 1 });

      const completed = await service.markJobRunCompleted(
        'import-job-row-purge',
        'run-123',
        now,
      );

      expect(completed).toBe(true);
      expect(mockScheduledJobRun.updateMany).toHaveBeenCalledWith({
        where: {
          job_name: 'import-job-row-purge',
          run_id: 'run-123',
        },
        data: {
          last_run_at: now,
          claimed_at: null,
        },
      });
    });

    it('returns false if run_id does not match (stale completed attempt)', async () => {
      mockScheduledJobRun.updateMany.mockResolvedValue({ count: 0 });

      const completed = await service.markJobRunCompleted(
        'import-job-row-purge',
        'stale-run-999',
        now,
      );

      expect(completed).toBe(false);
    });
  });
});
