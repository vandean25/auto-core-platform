import { Injectable, Logger, type INestApplication } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ScheduledJobService } from './scheduled-job.service.js';
import { ImportPurgeWorkerService } from '../import/import-purge-worker.service.js';

export const SCHEDULED_JOB_REQUEST_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class ScheduledJobTriggerService {
  private readonly logger = new Logger(ScheduledJobTriggerService.name);
  private lastRequestCheckTimestamp = 0;

  constructor(
    private readonly scheduledJobService: ScheduledJobService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Opportunistic trigger on incoming HTTP requests (AUT-839).
   * Non-blocking, fire-and-forget: returns void immediately, never awaited in request path.
   * Throttled to at most once per instance per hour. Errors are only logged.
   */
  triggerOpportunisticFromRequest(): void {
    const now = Date.now();
    if (
      now - this.lastRequestCheckTimestamp <
      SCHEDULED_JOB_REQUEST_CHECK_INTERVAL_MS
    ) {
      return;
    }
    this.lastRequestCheckTimestamp = now;

    void this.runDueJobs().catch((error) => {
      this.logger.error(
        `Opportunistic scheduled job trigger failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  }

  /**
   * Startup trigger executed after HTTP server is listening in the background (AUT-839).
   */
  triggerStartupJobs(): void {
    void this.runDueJobs().catch((error) => {
      this.logger.error(
        `Startup scheduled job trigger failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  }

  /**
   * Explicitly triggers a job by name (used by tests and scheduler runners).
   */
  async triggerJob(jobName: string): Promise<boolean> {
    if (jobName === 'import-job-row-purge') {
      const claim = await this.scheduledJobService.tryClaimJob({ jobName });
      if (claim.claimed) {
        const purgeWorker = this.moduleRef.get(ImportPurgeWorkerService, {
          strict: false,
        });
        if (purgeWorker) {
          await purgeWorker.dispatchPurgeTask({
            runId: claim.runId,
            sequence: 0,
          });
        }
        return true;
      }
      return false;
    }
    return false;
  }

  private async runDueJobs(): Promise<void> {
    await this.triggerJob('import-job-row-purge');
  }
}

/**
 * Runs startup scheduled job triggers on the application instance after listen.
 */
export function runStartupScheduledJobTrigger(app: INestApplication): void {
  try {
    const service = app.get(ScheduledJobTriggerService, { strict: false });
    service?.triggerStartupJobs();
  } catch (error) {
    // Startup trigger must never crash application bootstrap
    console.error(
      `Failed to initialize scheduled job startup trigger: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
