import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { readWorkshopCheckInOrphanUploadPurgeConfig } from './workshop-check-in-orphan-upload-cleanup.config.js';
import { purgeOrphanCheckInUploadsForTenant } from './workshop-check-in-orphan-upload-cleanup.js';

@Injectable()
export class WorkshopCheckInOrphanUploadCleanupService {
  private readonly logger = new Logger(
    WorkshopCheckInOrphanUploadCleanupService.name,
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly mediaStorage: MechanicMediaStorage,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'workshop-check-in-orphan-upload-cleanup',
  })
  async purgeOrphans(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    const config = readWorkshopCheckInOrphanUploadPurgeConfig();
    if (!config.enabled) {
      return true;
    }
    const cutoff = new Date(Date.now() - config.ttlMs);
    return this.systemPrisma.withCronJobLock(
      'workshop-check-in-orphan-upload-cleanup',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        for (const tenant of tenants) {
          try {
            const counts = await this.requestContext.runAsWorker(
              tenant.id,
              () =>
                purgeOrphanCheckInUploadsForTenant(
                  this.prisma,
                  this.mediaStorage,
                  tenant.id,
                  cutoff,
                  config.batchSize,
                ),
              { workerId: 'workshop-check-in-orphan-upload-cleanup' },
            );
            if (
              counts.deleted > 0 ||
              counts.skipped > 0 ||
              counts.storage_failed > 0
            ) {
              this.logger.log(
                `Check-in orphan upload purge tenant=${tenant.id} scanned=${counts.scanned} deleted=${counts.deleted} skipped=${counts.skipped} storage_failed=${counts.storage_failed}`,
              );
            }
          } catch (cause) {
            this.logger.error(
              `Check-in orphan upload purge failed for tenant=${tenant.id}: ${cause instanceof Error ? cause.message : 'unknown'}`,
            );
          }
        }
      },
      this.logger,
    );
  }
}
