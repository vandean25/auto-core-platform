import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationOutboxStatus } from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

/** Message bodies are cleared this long after creation (ADR-0025 §10). Metadata is kept. */
export const NOTIFICATION_BODY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Daily body purge. Only terminal rows are touched, so no body is removed before its send
 * attempt has finished. Runs per tenant under a worker context, like the recovery sweep.
 */
@Injectable()
export class NotificationOutboxRetentionService {
  private readonly logger = new Logger(NotificationOutboxRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron('17 3 * * *', { name: 'notification-outbox-body-purge' })
  async purgeBodies(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'notification-outbox-body-purge',
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
              { workerId: 'notification-outbox-body-purge' },
            );
          } catch (cause) {
            // One tenant's failure must not skip the tenants after it; the next night retries it.
            this.logger.error(
              `Notification body purge failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  private async purgeForTenant(tenantId: string, now: Date): Promise<void> {
    const result = await this.prisma.notificationOutbox.updateMany({
      where: {
        tenant_id: tenantId,
        body: { not: null },
        body_purged_at: null,
        status: {
          in: [
            NotificationOutboxStatus.ACCEPTED,
            NotificationOutboxStatus.FAILED,
            NotificationOutboxStatus.SUPPRESSED,
          ],
        },
        createdAt: {
          lt: new Date(now.getTime() - NOTIFICATION_BODY_RETENTION_MS),
        },
      },
      data: { body: null, body_purged_at: now },
    });
    if (result.count > 0) {
      this.logger.log(
        `Purged ${result.count} notification bodies for one tenant`,
      );
    }
  }
}
