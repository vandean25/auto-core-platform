import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { withStatusSpan } from '../common/observability/trace.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { ImportFileStorageService } from './import-file.storage.js';
import { readImportUploadRetentionDays } from './import-limits.js';
import { purgeStaleImportUploadsForTenant } from './import-upload-retention.helpers.js';

@Injectable()
export class ImportUploadRetentionService {
  private readonly logger = new Logger(ImportUploadRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly fileStorage: ImportFileStorageService,
  ) {}

  @Cron('47 3 * * *', { name: 'import-job-upload-purge' })
  async purgeStaleUploads(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'import-job-upload-purge',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = new Date();
        for (const { id: tenantId } of tenants) {
          try {
            await this.requestContext.runAsWorker(
              tenantId,
              () => this.purgeForTenant(tenantId, now),
              { workerId: 'import-job-upload-purge' },
            );
          } catch (cause) {
            this.logger.error(
              `Import upload retention failed for one tenant: ${cause instanceof Error ? cause.message : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  async purgeForTenant(tenantId: string, now: Date, dryRun = false) {
    return withStatusSpan(
      'Purge stale import uploads',
      'import.upload_retention.purge',
      {
        retention_days: readImportUploadRetentionDays(),
        dry_run: dryRun,
      },
      async (span) => {
        const counts = await purgeStaleImportUploadsForTenant(
          this.prisma,
          tenantId,
          now,
          {
            dryRun,
            deleteUpload: (upload) =>
              this.fileStorage.deleteUpload(upload).catch(() => undefined),
          },
        );
        span.setAttributes({
          jobs_scanned: counts.jobs_scanned,
          uploads_deleted: counts.uploads_deleted,
        });
        if (counts.uploads_deleted > 0 || counts.dry_run) {
          this.logger.log(
            `Import upload ${counts.dry_run ? 'dry-run' : 'purge'} for one tenant: jobs=${counts.jobs_scanned} uploads=${counts.uploads_deleted}`,
          );
        }
        return counts;
      },
    );
  }
}
