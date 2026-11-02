import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ImportPurgeWorkerService } from './import-purge-worker.service.js';
import {
  readImportJobRowPurgeMaxSequence,
  readImportJobRowPurgeRowBudget,
} from './import-limits.js';
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
        findMany: jest.fn(),
      },
    };
    mockPrisma = {
      importJob: {
        findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
      },
    };
    mockScheduledJobService = {
      getJobRun: jest.fn(),
      markJobRunCompleted: jest.fn(),
    };
    mockCloudTasks = {
      isEnabled: jest.fn().mockReturnValue(true),
      enqueueImportPurgeWorker: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue(undefined),
    };
    mockRequestContext = {
      runAsWorker: jest.fn(async (_tenantId: string, fn: () => Promise<any>) =>
        fn(),
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

  afterEach(() => {
    delete process.env.IMPORT_JOB_ROW_RETENTION_DRY_RUN;
    jest.restoreAllMocks();
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
    );
  });

  describe('re-enqueue bounds (AUT-839)', () => {
    const givenTenantWithWorkRemaining = () => {
      mockScheduledJobService.getJobRun.mockResolvedValue({
        job_name: 'import-job-row-purge',
        claimed_at: now,
        run_id: runId,
      });
      mockSystemPrisma.tenant.findMany
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([]);
      jest.spyOn(service, 'purgeForTenant').mockResolvedValue({
        jobs_scanned: 1,
        rows_deleted: readImportJobRowPurgeRowBudget(),
        dry_run: process.env.IMPORT_JOB_ROW_RETENTION_DRY_RUN === 'true',
      });
    };

    it('dry-run with rows remaining enqueues NO follow-up task (unbounded dry-run re-enqueue loop)', async () => {
      process.env.IMPORT_JOB_ROW_RETENTION_DRY_RUN = 'true';
      givenTenantWithWorkRemaining();

      const result = await service.processPurgeBatch({
        runId,
        sequence: 0,
      });

      expect(result.status).toBe('completed');
      expect(mockCloudTasks.enqueueImportPurgeWorker).not.toHaveBeenCalled();
      expect(mockScheduledJobService.markJobRunCompleted).toHaveBeenCalledWith(
        'import-job-row-purge',
        runId,
      );
    });

    it('dry-run with rows remaining schedules no in-process continuation when Cloud Tasks is disabled (tight setImmediate recursion)', async () => {
      process.env.IMPORT_JOB_ROW_RETENTION_DRY_RUN = 'true';
      mockCloudTasks.isEnabled.mockReturnValue(false);
      givenTenantWithWorkRemaining();
      const dispatchSpy = jest.spyOn(service, 'dispatchPurgeTask');

      const result = await service.processPurgeBatch({
        runId,
        sequence: 0,
      });

      expect(result.status).toBe('completed');
      expect(dispatchSpy).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockSystemPrisma.tenant.findMany).toHaveBeenCalledTimes(1);
    });

    it('stops the chain at MAX_PURGE_SEQUENCE with a warning instead of enqueuing (unbounded re-enqueue chain)', async () => {
      const maxSequence = readImportJobRowPurgeMaxSequence();
      givenTenantWithWorkRemaining();
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      const result = await service.processPurgeBatch({
        runId,
        sequence: maxSequence,
      });

      expect(result.status).toBe('completed');
      expect(mockCloudTasks.enqueueImportPurgeWorker).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`MAX_PURGE_SEQUENCE=${maxSequence}`),
      );
      expect(mockScheduledJobService.markJobRunCompleted).toHaveBeenCalledWith(
        'import-job-row-purge',
        runId,
      );
    });

    it('still enqueues the follow-up below MAX_PURGE_SEQUENCE when rows remain', async () => {
      const maxSequence = readImportJobRowPurgeMaxSequence();
      givenTenantWithWorkRemaining();

      const result = await service.processPurgeBatch({
        runId,
        sequence: maxSequence - 1,
      });

      expect(result).toEqual({
        status: 'continued',
        nextSequence: maxSequence,
      });
      expect(mockCloudTasks.enqueueImportPurgeWorker).toHaveBeenCalledWith({
        runId,
        sequence: maxSequence,
      });
    });
  });
});
