import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ScheduledJobRun } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

export const DEFAULT_SCHEDULED_JOB_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_SCHEDULED_JOB_LEASE_MS = 2 * 60 * 60 * 1000; // 2 hours

export type ClaimJobResult =
  { claimed: true; runId: string } | { claimed: false };

export interface TryClaimJobParams {
  jobName: string;
  now?: Date;
  intervalMs?: number;
  leaseMs?: number;
}

@Injectable()
export class ScheduledJobService {
  private readonly logger = new Logger(ScheduledJobService.name);

  constructor(private readonly systemPrisma: SystemPrismaService) {}

  /**
   * Ensures the scheduled job row exists in the DB (ON CONFLICT DO NOTHING).
   */
  async ensureJobRow(jobName: string): Promise<void> {
    await this.systemPrisma.scheduledJobRun.upsert({
      where: { job_name: jobName },
      create: { job_name: jobName },
      update: {},
    });
  }

  /**
   * Attempts an atomic compare-and-set claim for a scheduled background job (AUT-839).
   *
   * A single conditional UPDATE succeeds only if:
   * 1. (last_run_at IS NULL OR last_run_at < now - interval) AND
   * 2. (claimed_at IS NULL OR claimed_at < now - lease)
   *
   * Only the winning instance affects 1 row. No read-then-write race.
   */
  async tryClaimJob(params: TryClaimJobParams): Promise<ClaimJobResult> {
    const jobName = params.jobName;
    const now = params.now ?? new Date();
    const intervalMs = params.intervalMs ?? DEFAULT_SCHEDULED_JOB_INTERVAL_MS;
    const leaseMs = params.leaseMs ?? DEFAULT_SCHEDULED_JOB_LEASE_MS;

    await this.ensureJobRow(jobName);

    const intervalCutoff = new Date(now.getTime() - intervalMs);
    const leaseCutoff = new Date(now.getTime() - leaseMs);
    const runId = randomUUID();

    const result = await this.systemPrisma.scheduledJobRun.updateMany({
      where: {
        job_name: jobName,
        AND: [
          {
            OR: [
              { last_run_at: null },
              { last_run_at: { lt: intervalCutoff } },
            ],
          },
          {
            OR: [{ claimed_at: null }, { claimed_at: { lt: leaseCutoff } }],
          },
        ],
      },
      data: {
        claimed_at: now,
        run_id: runId,
      },
    });

    if (result.count === 1) {
      this.logger.log(`Claimed scheduled job "${jobName}" (runId: ${runId})`);
      return { claimed: true, runId };
    }

    return { claimed: false };
  }

  /**
   * Marks a scheduled job run completed: sets last_run_at and clears claimed_at.
   * Only affects the row if the current run_id matches the caller's runId.
   */
  async markJobRunCompleted(
    jobName: string,
    runId: string,
    completedAt?: Date,
  ): Promise<boolean> {
    const now = completedAt ?? new Date();
    const result = await this.systemPrisma.scheduledJobRun.updateMany({
      where: {
        job_name: jobName,
        run_id: runId,
      },
      data: {
        last_run_at: now,
        claimed_at: null,
      },
    });

    if (result.count === 1) {
      this.logger.log(`Completed scheduled job "${jobName}" (runId: ${runId})`);
      return true;
    }

    this.logger.warn(
      `Failed to mark scheduled job "${jobName}" completed for runId: ${runId} (stale or unowned)`,
    );
    return false;
  }

  /**
   * Returns current run state of a scheduled job.
   */
  async getJobRun(jobName: string): Promise<ScheduledJobRun | null> {
    return this.systemPrisma.scheduledJobRun.findUnique({
      where: { job_name: jobName },
    });
  }
}
