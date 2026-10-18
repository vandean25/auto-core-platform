import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { DocumentBrandingAssetCleanupService } from './document-branding-asset-cleanup.service.js';
import { DocumentBrandingUploadRequeueService } from './document-branding-upload-requeue.service.js';

const QUOTA_EVENT_RETENTION_MS = 60 * 60 * 1000;

/**
 * Runs the per-minute recovery sweep for every tenant as a worker. The sweep order is
 * fixed: prune quota events, reject exhausted quarantines, requeue stalled validations,
 * purge expired assets, then drop stale quarantine copies.
 */
@Injectable()
export class DocumentBrandingUploadRecoveryService {
  private readonly logger = new Logger(DocumentBrandingUploadRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly requeue: DocumentBrandingUploadRequeueService,
    private readonly cleanup: DocumentBrandingAssetCleanupService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'document-branding-upload-recovery',
  })
  async recoverAndClean() {
    await this.systemPrisma.withCronJobLock(
      'document-branding-upload-recovery',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        if (tenants.length === 0) return;

        const now = new Date();
        for (const { id: tenantId } of tenants) {
          await this.requestContext.runAsWorker(
            tenantId,
            () => this.recoverAndCleanForTenant(now),
            { workerId: 'document-branding-upload-recovery' },
          );
        }
      },
      this.logger,
    );
  }

  private async recoverAndCleanForTenant(now: Date) {
    await this.prisma.documentBrandQuotaEvent.deleteMany({
      where: {
        created_at: { lt: new Date(now.getTime() - QUOTA_EVENT_RETENTION_MS) },
      },
    });
    await this.requeue.rejectExhausted(now);
    await this.requeue.requeuePending(now);
    await this.cleanup.purgeExpired(now);
    await this.cleanup.removeStaleQuarantineCopies();
  }
}
