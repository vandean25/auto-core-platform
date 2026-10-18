import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { DocumentBrandingAssetCleanupService } from './document-branding-asset-cleanup.service.js';
import { DocumentBrandingUploadRequeueService } from './document-branding-upload-requeue.service.js';
import { runDocumentBrandingRecoveryCron } from './document-branding-tenant-recovery-cron.js';
import { runUploadRecoveryTenantSweep } from './document-branding-upload-recovery-tenant.js';

/**
 * Runs the per-minute recovery sweep for every tenant as a worker. The sweep order is
 * fixed: prune quota events, reject exhausted quarantines, requeue stalled validations,
 * purge expired assets, then drop stale quarantine copies.
 */
@Injectable()
export class DocumentBrandingUploadRecoveryRunner {
  private readonly logger = new Logger(
    DocumentBrandingUploadRecoveryRunner.name,
  );

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
  recoverAndClean() {
    return runDocumentBrandingRecoveryCron({
      jobName: 'document-branding-upload-recovery',
      logger: this.logger,
      systemPrisma: this.systemPrisma,
      requestContext: this.requestContext,
      workerId: 'document-branding-upload-recovery',
      runForTenant: (now) =>
        runUploadRecoveryTenantSweep({
          now,
          prisma: this.prisma,
          requeue: this.requeue,
          cleanup: this.cleanup,
        }),
    });
  }
}
