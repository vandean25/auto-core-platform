import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ImportPurgeWorkerService } from './import-purge-worker.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { ImportRetentionService } from './import-retention.service.js';
import type { ScheduledJobService } from '../scheduler/scheduled-job.service.js';
import type { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('ImportPurgeWorkerService', () => {
  let service: ImportPurgeWorkerService;
  let mockSystemPrisma: any;
  let mockPrisma: any;
  let mockScheduledJobService: any;
  let mockCloudTasks: any;
  let mockRequestContext: any;

  const runId = 'test-run-123';
  const now = new Date('2026-11-01T12:00:00.000Z');

  beforeEach(() => {
    mockSystemPrisma = {
      tenant: {
        findMany: jest.fn<any>(),
      },
    };
    mockPrisma = {
      importJob: {
        findMany: jest.fn<any>().mockResolvedValue([]),
      },
    };
    mockScheduledJobService = {
      getJobRun: jest.fn<any>(),
      markJobRunCompleted: jest.fn<any>(),
    };
    mockCloudTasks = {
      isEnabled: jest.fn<any>().mockReturnValue(true),
      enqueueImportPurgeWorker: jest.fn<any>().mockResolvedValue(undefined),
    };
    mockRequestContext = {
      runAsWorker: jest.fn<any>().mockImplementation(
        async (_tenantId: string, fn: () => Promise<any>) => fn(),
      ),
    };

    service = new ImportPurgeWorkerService(
      mockSystemPrisma,
      mockPrisma,
      mockScheduledJobService,
      mockCloudTasks,
      mockRequestContext,
    );
  });

  it('skips (no-op) when task payload has a stale or unowned runId', async () => {
    mockScheduledJobService.getJobRun.mockResolvedValue({
      job_name: 'import-job-row-purge',
      claimed_at: now,
      run_id: 'different-active-run',
    });

    const result = await service.processPurgeBatch({
      runId: 'stale-run-456',
      sequence: 0,
    });

    expect(result.status).toBe('stale');
    expect(mockSystemPrisma.tenant.findMany).not.toHaveBeenCalled();
    expect(mockCloudTasks.enqueueImportPurgeWorker).not.toHaveBeenCalled();
    expect(mockScheduledJobService.markJobRunCompleted).not.toHaveBeenCalled();
  });

  it('skips (no-op) when job claim has already been released (claimed_at is null)', async () => {
    mockScheduledJobService.getJobRun.mockResolvedValue({
      job_name: 'import-job-row-purge',
      claimed_at: null,
      run_id: runId,
    });

    const result = await service.processPurgeBatch({
      runId,
      sequence: 0,
    });

    expect(result.status).toBe('stale');
    expect(mockSystemPrisma.tenant.findMany).not.toHaveBeenCalled();
  });

  it('purges tenants and re-enqueues sequence + 1 when rows remain', async () => {
    mockScheduledJobService.getJobRun.mockResolvedValue({
      job_name: 'import-job-row-purge',
      claimed_at: now,
      run_id: runId,
    });

    mockSystemPrisma.tenant.findMany
      .mockResolvedValueOnce([{ id: 'tenant-1' }])
      .mockResolvedValueOnce([]);

    // Tenant 1 reached rowBudget (e.g. 20,000 rows)
    const purgeSpy = jest.spyOn(service, 'purgeForTenant').mockResolvedValue({
      jobs_scanned: 1,
      rows_deleted: 20000,
      dry_run: false,
    });

    const result = await service.processPurgeBatch({
      runId,
      sequence: 0,
    });

    expect(result.status).toBe('continued');
    expect(purgeSpy).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(Date),
      false,
      expect.objectContaining({ rowBudget: 20000 }),
    );
    expect(mockCloudTasks.enqueueImportPurgeWorker).toHaveBeenCalledWith({
      runId,
      sequence: 1,
    });
    expect(mockScheduledJobService.markJobRunCompleted).not.toHaveBeenCalled();
  });

  it('marks job run completed when all tenants have zero remaining rows', async () => {
    mockScheduledJobService.getJobRun.mockResolvedValue({
      job_name: 'import-job-row-purge',
      claimed_at: now,
      run_id: runId,
    });

    mockSystemPrisma.tenant.findMany
      .mockResolvedValueOnce([{ id: 'tenant-1' }])
      .mockResolvedValueOnce([]);

    // Tenant 1 had 5 rows, all deleted (< 20000) and only 1 job scanned (< 25)
    jest.spyOn(service, 'purgeForTenant').mockResolvedValue({
      jobs_scanned: 1,
      rows_deleted: 5,
      dry_run: false,
    });

    const result = await service.processPurgeBatch({
      runId,
      sequence: 1,
    });

    expect(result.status).toBe('completed');
    expect(mockCloudTasks.enqueueImportPurgeWorker).not.toHaveBeenCalled();
    expect(mockScheduledJobService.markJobRunCompleted).toHaveBeenCalledWith(
      'import-job-row-purge',
      runId,
      expect.any(Date),
    );
  });
});
