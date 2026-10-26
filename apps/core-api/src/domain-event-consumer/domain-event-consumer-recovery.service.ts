import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DOMAIN_EVENT_TYPES } from '../domain-event-store/domain-event.constants.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { WorkshopEstimateDecidedConsumerService } from '../workshop/workshop-estimate-decided-consumer.service.js';

/**
 * Catches up estimate-decided consumers when a wake-up was lost (AUT-544). Each active tenant
 * receives at most one bounded batch per minute; claims keep two instances from duplicating work.
 */
@Injectable()
export class DomainEventConsumerRecoveryService {
  private readonly logger = new Logger(DomainEventConsumerRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly estimateDecidedConsumer: WorkshopEstimateDecidedConsumerService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'domain-event-consumer-recovery' })
  async recover(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'domain-event-consumer-recovery',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          where: { is_active: true },
          select: { id: true },
        });
        for (const tenant of tenants) {
          try {
            const hasPending = await this.tenantHasPendingEstimateDecidedEvents(
              tenant.id,
            );
            if (!hasPending) {
              continue;
            }
            await this.requestContext.runAsWorker(
              tenant.id,
              () => this.estimateDecidedConsumer.processTenantBatch(tenant.id),
              { workerId: 'domain-event-consumer-recovery' },
            );
          } catch (cause) {
            this.logger.error(
              `Domain event consumer recovery failed for tenant ${tenant.id}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  private async tenantHasPendingEstimateDecidedEvents(
    tenantId: string,
  ): Promise<boolean> {
    return this.requestContext.runAsWorker(tenantId, async () => {
      const progress = await this.prisma.domainEventConsumerProgress.findFirst({
        where: {
          tenant_id: tenantId,
          consumer_key: this.estimateDecidedConsumer.consumerKey,
        },
        select: { cursor_sequence: true },
      });
      const cursor = progress?.cursor_sequence ?? BigInt(0);
      const pending = await this.prisma.domainEvent.findFirst({
        where: {
          tenant_id: tenantId,
          event_type: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
          sequence: { gt: cursor },
        },
        select: { id: true },
      });
      return pending !== null;
    });
  }
}
