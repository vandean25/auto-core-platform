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

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));

    mockScheduledJobService = {
      tryClaimJob: jest.fn<any>().mockResolvedValue({ claimed: false }),
    };
    mockPurgeWorkerService = {
      dispatchPurgeTask: jest.fn<any>().mockResolvedValue(undefined),
    };

    const mockModuleRef = {
      get: jest.fn<any>().mockReturnValue(mockPurgeWorkerService),
    };

    service = new ScheduledJobTriggerService(
      mockScheduledJobService as unknown as ScheduledJobService,
      mockModuleRef as unknown as any,
    );
  });

  afterEach(() => {
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
        // @ts-expect-error accessing private logger
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
  });
});
