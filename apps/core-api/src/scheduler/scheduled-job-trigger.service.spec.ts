import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import {
  ScheduledJobTriggerService,
  runStartupScheduledJobTrigger,
} from './scheduled-job-trigger.service.js';
import type { ScheduledJobService } from './scheduled-job.service.js';
import type { ImportPurgeWorkerService } from '../import/import-purge-worker.service.js';

describe('ScheduledJobTriggerService', () => {
  let service: ScheduledJobTriggerService;
  let mockScheduledJobService: {
    tryClaimJob: jest.MockedFunction<any>;
  };
  let mockPurgeWorkerService: {
    dispatchPurgeTask: jest.MockedFunction<any>;
  };
  let mockLogger: {
    log: jest.MockedFunction<any>;
    error: jest.MockedFunction<any>;
    warn: jest.MockedFunction<any>;
  };
  const savedSchedulerMode = process.env.SCHEDULER_MODE;
  const savedSchedulerEnabled = process.env.SCHEDULER_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    process.env.SCHEDULER_MODE = 'in-process';
    delete process.env.SCHEDULER_ENABLED;

    mockScheduledJobService = {
      tryClaimJob: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue({ claimed: false }),
    };
    mockPurgeWorkerService = {
      dispatchPurgeTask: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue(undefined),
    };

    const mockModuleRef = {
      get: jest.fn().mockReturnValue(mockPurgeWorkerService),
    };

    service = new ScheduledJobTriggerService(
      mockScheduledJobService as unknown as ScheduledJobService,
      mockModuleRef as unknown as any,
    );
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedSchedulerMode === undefined) {
      delete process.env.SCHEDULER_MODE;
    } else {
      process.env.SCHEDULER_MODE = savedSchedulerMode;
    }
    if (savedSchedulerEnabled === undefined) {
      delete process.env.SCHEDULER_ENABLED;
    } else {
      process.env.SCHEDULER_ENABLED = savedSchedulerEnabled;
    }
    jest.useRealTimers();
  });

  describe('triggerOpportunisticFromRequest', () => {
    it('checks at most once per hour per instance', async () => {
      // First request: triggers check
      const returnVal1 = service.triggerOpportunisticFromRequest();
      // Must return void (never a Promise) so it cannot be awaited in the request path
      expect(returnVal1).toBeUndefined();

      // Flush microtasks
      await Promise.resolve();
      expect(mockScheduledJobService.tryClaimJob).toHaveBeenCalledTimes(1);

      // Second request 5 minutes later: throttled, no DB check
      jest.advanceTimersByTime(5 * 60 * 1000);
      const returnVal2 = service.triggerOpportunisticFromRequest();
      expect(returnVal2).toBeUndefined();
      await Promise.resolve();
      expect(mockScheduledJobService.tryClaimJob).toHaveBeenCalledTimes(1);

      // Third request 61 minutes later: checks again
      jest.advanceTimersByTime(56 * 60 * 1000); // total 61 minutes
      service.triggerOpportunisticFromRequest();
      await Promise.resolve();
      expect(mockScheduledJobService.tryClaimJob).toHaveBeenCalledTimes(2);
    });

    it('never delays or fails a request when trigger throws an error', async () => {
      const errorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => {});

      mockScheduledJobService.tryClaimJob.mockRejectedValue(
        new Error('DB connection dropped'),
      );

      expect(() => {
        const ret = service.triggerOpportunisticFromRequest();
        expect(ret).toBeUndefined();
      }).not.toThrow();

      // Flush all microtasks
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('DB connection dropped'),
      );
    });

    it('dispatches purge task when claim succeeds', async () => {
      mockScheduledJobService.tryClaimJob.mockResolvedValue({
        claimed: true,
        runId: 'winner-run-123',
      });

      service.triggerOpportunisticFromRequest();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPurgeWorkerService.dispatchPurgeTask).toHaveBeenCalledWith({
        runId: 'winner-run-123',
        sequence: 0,
      });
    });
  });

  describe('triggerStartupJobs', () => {
    it('runs due jobs in background without throwing', async () => {
      mockScheduledJobService.tryClaimJob.mockResolvedValue({
        claimed: true,
        runId: 'startup-run-456',
      });

      service.triggerStartupJobs();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockScheduledJobService.tryClaimJob).toHaveBeenCalledWith({
        jobName: 'import-job-row-purge',
      });
      expect(mockPurgeWorkerService.dispatchPurgeTask).toHaveBeenCalledWith({
        runId: 'startup-run-456',
        sequence: 0,
      });
    });

    it('runStartupScheduledJobTrigger invokes triggerStartupJobs on the app instance', () => {
      const mockTriggerService = {
        triggerStartupJobs: jest.fn<any>(),
      };
      const mockApp = {
        get: jest.fn<any>().mockReturnValue(mockTriggerService),
      } as unknown as INestApplication;

      runStartupScheduledJobTrigger(mockApp);
      expect(mockApp.get).toHaveBeenCalledWith(ScheduledJobTriggerService, {
        strict: false,
      });
      expect(mockTriggerService.triggerStartupJobs).toHaveBeenCalledTimes(1);
    });

    it('WHEN the pdf worker starts with SCHEDULER_MODE=off THEN the startup trigger does not claim any scheduled_job_runs row', async () => {
      process.env.SCHEDULER_MODE = 'off';

      service.triggerStartupJobs();
      await flushPendingTriggerWork();

      expect(mockScheduledJobService.tryClaimJob).not.toHaveBeenCalled();
      expect(mockPurgeWorkerService.dispatchPurgeTask).not.toHaveBeenCalled();
    });

    it('WHEN core-api starts after a deploy with SCHEDULER_MODE=http THEN the startup trigger claims the due purge run and dispatches it via the purge worker', async () => {
      process.env.SCHEDULER_MODE = 'http';
      mockScheduledJobService.tryClaimJob.mockResolvedValue({
        claimed: true,
        runId: 'deploy-run-789',
      });

      service.triggerStartupJobs();
      await flushPendingTriggerWork();

      expect(mockScheduledJobService.tryClaimJob).toHaveBeenCalledWith({
        jobName: 'import-job-row-purge',
      });
      expect(mockPurgeWorkerService.dispatchPurgeTask).toHaveBeenCalledWith({
        runId: 'deploy-run-789',
        sequence: 0,
      });
    });

    it('WHEN the trigger is disabled with SCHEDULER_MODE=off THEN neither startup nor request paths reach the database and no trigger error is logged', async () => {
      const errorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => {});
      mockScheduledJobService.tryClaimJob.mockRejectedValue(
        new Error('Startup scheduled job trigger should never run'),
      );
      process.env.SCHEDULER_MODE = 'off';

      service.triggerStartupJobs();
      service.triggerOpportunisticFromRequest();
      await flushPendingTriggerWork();

      expect(mockScheduledJobService.tryClaimJob).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});

/** Await every microtask queued by the fire-and-forget trigger paths. */
async function flushPendingTriggerWork(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
