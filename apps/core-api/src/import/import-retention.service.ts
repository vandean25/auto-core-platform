import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { withStatusSpan } from '../common/observability/trace.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { IMPORT_JOB_RETENTION_DAYS } from './import.constants.js';
import {
  purgeStaleImportJobRowsForTenant,
  readImportJobRowRetentionPurgeConfig,
  type ImportJobRowPurgeCounts,
} from './import-retention.helpers.js';

/**
 * Purges legacy import row payloads (PII from CSV dry-runs) after retention while keeping
 * job headers and external id mappings for reconciliation.
 */
@Injectable()
export class ImportRetentionService {
  private readonly logger = new Logger(ImportRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron('31 3 * * *', { name: 'import-job-row-purge' })
  async purgeStaleRows(): Promise<void> {
    await this.systemPrisma.withCronJobLock(
      'import-job-row-purge',
      async () => {
        const config = readImportJobRowRetentionPurgeConfig();
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = new Date();
        for (const { id: tenantId } of tenants) {
          try {
            await this.requestContext.runAsWorker(
              tenantId,
              () => this.purgeForTenant(tenantId, now, config.dryRun),
              { workerId: 'import-job-row-purge' },
            );
          } catch (cause) {
            this.logger.error(
              `Import job row purge failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  async purgeForTenant(
    tenantId: string,
    now: Date,
    dryRun = false,
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
          { dryRun },
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
}
