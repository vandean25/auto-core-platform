import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { purgeExpiredConsentProofRows } from './customer-consent-retention-purge.helpers.js';

/**
 * Purges expired consent proof rows per tenant (AUT-374). Runs on the same daily worker
 * schedule pattern as notification outbox body retention.
 */
@Injectable()
export class CustomerConsentRetentionService {
  private readonly logger = new Logger(CustomerConsentRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron('23 3 * * *', { name: 'customer-consent-proof-purge' })
  async purgeExpiredProofRows(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'customer-consent-proof-purge',
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
              { workerId: 'customer-consent-proof-purge' },
            );
          } catch (cause) {
            this.logger.error(
              `Customer consent proof purge failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  async purgeForTenant(tenantId: string, now: Date): Promise<number> {
    const [consentPurged, tokenResult] = await Promise.all([
      purgeExpiredConsentProofRows(this.prisma, tenantId, now),
      this.prisma.customerConsentUnsubscribeToken.deleteMany({
        where: {
          tenant_id: tenantId,
          retain_until: { lt: now },
        },
      }),
    ]);
    const total = consentPurged + tokenResult.count;
    if (total > 0) {
      this.logger.log(
        `Purged ${consentPurged} consent proof rows and ${tokenResult.count} unsubscribe tokens for one tenant`,
      );
    }
    return total;
  }

  async setLegalHoldForChain(
    tenantId: string,
    params: {
      controllerLegalEntityId: string;
      customerId: string;
      channel: Prisma.CustomerConsentWhereInput['channel'];
      purpose: Prisma.CustomerConsentWhereInput['purpose'];
      legalHold: boolean;
    },
  ): Promise<number> {
    const result = await this.prisma.customerConsent.updateMany({
      where: {
        tenant_id: tenantId,
        controller_legal_entity_id: params.controllerLegalEntityId,
        customer_id: params.customerId,
        channel: params.channel,
        purpose: params.purpose,
      },
      data: { legal_hold: params.legalHold },
    });
    return result.count;
  }
}
