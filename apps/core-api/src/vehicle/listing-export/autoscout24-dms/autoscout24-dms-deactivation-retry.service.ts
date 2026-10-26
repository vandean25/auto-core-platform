import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestContextService } from '../../../common/services/request-context.service.js';
import { SystemPrismaService } from '../../../prisma/system-prisma.service.js';
import { isVehicleListingAs24PushEnvEnabled } from './autoscout24-dms-env.js';
import { Autoscout24DmsListingPushService } from './autoscout24-dms-listing-push.service.js';

/**
 * Sweeps DEACTIVATION_PENDING DMS sync rows and retries remote deactivate calls.
 * Gated by the deployment env flag and per-tenant push settings (default off).
 */
@Injectable()
export class Autoscout24DmsDeactivationRetryService {
  private readonly logger = new Logger(
    Autoscout24DmsDeactivationRetryService.name,
  );

  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly pushService: Autoscout24DmsListingPushService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'autoscout24-dms-deactivation-retry',
  })
  async runScheduledRetries(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    if (!isVehicleListingAs24PushEnvEnabled()) {
      return true;
    }
    return this.systemPrisma.withCronJobLock(
      'autoscout24-dms-deactivation-retry',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          where: {
            vehicleListingPushSettings: { is: { as24_dms_push_enabled: true } },
          },
          select: { id: true },
        });
        for (const { id: tenantId } of tenants) {
          await this.requestContext.runAsWorker(
            tenantId,
            () => this.pushService.retryPendingDeactivations(),
            { workerId: 'autoscout24-dms-deactivation-retry' },
          );
        }
      },
      this.logger,
    );
  }
}
