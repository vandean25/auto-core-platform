import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { withStatusSpan } from '../common/observability/trace.js';
import { ScheduledJobService } from '../scheduler/scheduled-job.service.js';
import { IMPORT_JOB_RETENTION_DAYS } from './import.constants.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import {
  fetchEligiblePurgeJobs,
  importJobRowPurgeCutoffs,
  purgeStaleImportJobRowsForTenant,
  readImportJobRowRetentionPurgeConfig,
  IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT,
  type ImportJobRowPurgeCounts,
  type ImportJobRowPurgeOptions,
} from './import-retention.helpers.js';
import { readImportJobRowPurgeRowBudget } from './import-limits.js';
import type { ImportPurgeTaskPayload } from './import-purge-task.payload.js';

export type PurgeBatchResult =
  | { status: 'stale' }
  | { status: 'continued'; nextSequence: number }
  | { status: 'completed' };

@Injectable()
export class ImportPurgeWorkerService {
  private readonly logger = new Logger(ImportPurgeWorkerService.name);
  private static readonly TENANT_PAGE_SIZE = 50;

  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly prisma: PrismaService,
    private readonly scheduledJobService: ScheduledJobService,
    private readonly cloudTasks: ImportCloudTasksService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Purges stale import job rows for a single tenant within an observability status span.
   */
  async purgeForTenant(
    tenantId: string,
    now: Date,
    dryRun = false,
    options: Omit<ImportJobRowPurgeOptions, 'dryRun'> = {},
  ): Promise<ImportJobRowPurgeCounts> {
    return withStatusSpan(
      'Purge stale import job rows',
      'import.retention.purge',
      {
        retention_days: IMPORT_JOB_RETENTION_DAYS,
        dry_run: dryRun,
      },
      async (span) => {
        const counts = await purgeStaleImportJobRowsForTenant(
          this.prisma,
          tenantId,
          now,
          { ...options, dryRun, logger: this.logger },
        );
        span.setAttributes({
          jobs_scanned: counts.jobs_scanned,
          rows_deleted: counts.rows_deleted,
        });
        if (counts.rows_deleted > 0 || counts.dry_run) {
          this.logger.log(
            `Import job row ${counts.dry_run ? 'dry-run' : 'purge'} for one tenant: jobs=${counts.jobs_scanned} rows=${counts.rows_deleted}`,
          );
        }
        return counts;
      },
    );
  }

  /**
   * Dispatches a purge task: enqueues via Cloud Tasks if enabled, or runs in-process in the background.
   */
  async dispatchPurgeTask(params: {
    runId: string;
    sequence: number;
  }): Promise<void> {
    if (this.cloudTasks.isEnabled()) {
      await this.cloudTasks.enqueueImportPurgeWorker(params);
    } else {
      setImmediate(() => {
        void this.processPurgeBatch(params).catch((error) => {
          this.logger.error(
            `In-process import purge failed for runId=${params.runId} seq=${params.sequence}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        });
      });
    }
  }

  /**
   * Processes one purge batch invocation (up to rowBudget rows per tenant).
   * Re-enqueues itself if rows remain; marks run completed when done.
   */
  async processPurgeBatch(
    payload: ImportPurgeTaskPayload,
  ): Promise<PurgeBatchResult> {
    const jobRun = await this.scheduledJobService.getJobRun(
      'import-job-row-purge',
    );

    if (
      !jobRun ||
      jobRun.claimed_at === null ||
      jobRun.run_id !== payload.runId
    ) {
      this.logger.log(
        `Purge worker received stale or unowned task (payload.runId=${payload.runId}, active.runId=${jobRun?.run_id}, active.claimed_at=${jobRun?.claimed_at?.toISOString()}). Skipping (204).`,
      );
      return { status: 'stale' };
    }

    const now = new Date();
    const config = readImportJobRowRetentionPurgeConfig();
    const rowBudget = readImportJobRowPurgeRowBudget();
    const rowsRemain = await this.purgeAllTenants(
      now,
      config.dryRun,
      rowBudget,
    );

    if (rowsRemain) {
      this.logger.log(
        `Import purge runId=${payload.runId} sequence=${payload.sequence} finished with remaining rows. Enqueuing sequence=${payload.sequence + 1}`,
      );
      await this.dispatchPurgeTask({
        runId: payload.runId,
        sequence: payload.sequence + 1,
      });
      return { status: 'continued', nextSequence: payload.sequence + 1 };
    }

    this.logger.log(
      `Import purge runId=${payload.runId} sequence=${payload.sequence} completed all tenants. Marking run completed.`,
    );
    await this.scheduledJobService.markJobRunCompleted(
      'import-job-row-purge',
      payload.runId,
      now,
    );
    return { status: 'completed' };
  }

  private async purgeAllTenants(
    now: Date,
    dryRun: boolean,
    rowBudget: number,
  ): Promise<boolean> {
    let rowsRemain = false;
    let skip = 0;

    while (true) {
      const tenants = await this.systemPrisma.tenant.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        skip,
        take: ImportPurgeWorkerService.TENANT_PAGE_SIZE,
      });

      if (tenants.length === 0) {
        break;
      }

      for (const { id: tenantId } of tenants) {
        const tenantHasMore = await this.purgeSingleTenant(
          tenantId,
          now,
          dryRun,
          rowBudget,
        );
        if (tenantHasMore) {
          rowsRemain = true;
        }
      }

      skip += tenants.length;
      if (tenants.length < ImportPurgeWorkerService.TENANT_PAGE_SIZE) {
        break;
      }
    }

    return rowsRemain;
  }

  private async purgeSingleTenant(
    tenantId: string,
    now: Date,
    dryRun: boolean,
    rowBudget: number,
  ): Promise<boolean> {
    try {
      const counts = await this.requestContext.runAsWorker(
        tenantId,
        () =>
          this.purgeForTenant(tenantId, now, dryRun, {
            rowBudget,
          }),
        { workerId: 'import-job-row-purge' },
      );

      if (counts.rows_deleted >= rowBudget) {
        return true;
      }
      if (counts.jobs_scanned >= IMPORT_JOB_ROW_PURGE_JOBS_PER_TENANT) {
        const cutoffs = importJobRowPurgeCutoffs(now);
        const remaining = await fetchEligiblePurgeJobs(
          this.prisma,
          tenantId,
          cutoffs,
          1,
        );
        return remaining.length > 0;
      }
    } catch (error) {
      this.logger.error(
        `Import job row purge failed for tenant ${tenantId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    return false;
  }
}
