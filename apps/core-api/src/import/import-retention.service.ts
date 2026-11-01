import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { ScheduledJobService } from '../scheduler/scheduled-job.service.js';
import {
  type ImportJobRowPurgeCounts,
  type ImportJobRowPurgeOptions,
} from './import-retention.helpers.js';
import { ImportPurgeWorkerService } from './import-purge-worker.service.js';

/**
 * Purges legacy import row payloads (PII from CSV dry-runs) after retention while keeping
 * job headers and external id mappings for reconciliation.
 */
@Injectable()
export class ImportRetentionService {
  private readonly logger = new Logger(ImportRetentionService.name);

  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly scheduledJobService: ScheduledJobService,
    private readonly purgeWorkerService: ImportPurgeWorkerService,
  ) {}

  @Cron('31 3 * * *', { name: 'import-job-row-purge' })
  async purgeStaleRows(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'import-job-row-purge',
      async () => {
        const claim = await this.scheduledJobService.tryClaimJob({
          jobName: 'import-job-row-purge',
        });

        if (claim.claimed) {
          await this.purgeWorkerService.dispatchPurgeTask({
            runId: claim.runId,
            sequence: 0,
          });
        }
      },
      this.logger,
    );
  }

  async purgeForTenant(
    tenantId: string,
    now: Date,
    dryRun = false,
    options: Omit<ImportJobRowPurgeOptions, 'dryRun'> = {},
  ): Promise<ImportJobRowPurgeCounts> {
    return this.purgeWorkerService.purgeForTenant(
      tenantId,
      now,
      dryRun,
      options,
    );
  }
}
