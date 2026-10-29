import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestContextService } from '../common/services/request-context.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { WorkshopCommandSessionService } from './workshop-command-session.service.js';

/**
 * Replay rows hold surname, plate and VIN tokens. The in-request purge only
 * runs for a tenant that keeps using the command box, so this sweep bounds the
 * retention of an idle tenant instead of letting its rows sit for seven days.
 */
@Injectable()
export class WorkshopCommandSessionRetentionService {
  private readonly logger = new Logger(
    WorkshopCommandSessionRetentionService.name,
  );

  constructor(
    private readonly sessions: WorkshopCommandSessionService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'workshop-command-session-purge' })
  async purgeExpired(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'workshop-command-session-purge',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = new Date();
        let deleted = 0;
        for (const tenant of tenants) {
          try {
            deleted += await this.requestContext.runAsWorker(
              tenant.id,
              () => this.sessions.purgeExpired(tenant.id, now),
              { workerId: 'workshop-command-session-purge' },
            );
          } catch (cause) {
            this.logger.error(
              `Workshop command session purge failed for one tenant: ${cause instanceof Error ? cause.message : 'unknown'}`,
            );
          }
        }
        if (deleted > 0) {
          this.logger.log(
            `Workshop command session purge deleted ${deleted} replay rows`,
          );
        }
      },
      this.logger,
    );
  }
}
