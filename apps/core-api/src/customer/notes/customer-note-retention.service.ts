import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CustomerNoteRetentionClass } from '@prisma/client';
import { RequestContextService } from '../../common/services/request-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
import {
  computeCustomerNoteRetainUntil,
  resolveLastCustomerActivityMap,
} from './customer-note-retention.helpers.js';

@Injectable()
export class CustomerNoteRetentionService {
  private readonly logger = new Logger(CustomerNoteRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron('29 3 * * *', { name: 'customer-note-retention-purge' })
  async purgeExpiredNotes(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'customer-note-retention-purge',
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
              { workerId: 'customer-note-retention-purge' },
            );
          } catch (cause) {
            this.logger.error(
              `Customer note retention purge failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  async purgeForTenant(tenantId: string, now: Date): Promise<number> {
    const candidates = await this.prisma.customerNote.findMany({
      where: {
        tenant_id: tenantId,
        legal_hold: false,
        retain_until: { lt: now },
      },
      select: {
        id: true,
        customer_id: true,
        retention_class: true,
        retain_until: true,
      },
    });
    if (candidates.length === 0) {
      return 0;
    }

    const operationalCustomerIds = candidates
      .filter(
        (c) => c.retention_class === CustomerNoteRetentionClass.OPERATIONAL,
      )
      .map((c) => c.customer_id);
    const tenantSites =
      operationalCustomerIds.length > 0
        ? await this.prisma.site.findMany({
            where: { tenant_id: tenantId },
            select: { id: true },
          })
        : [];
    const activityByCustomer = await resolveLastCustomerActivityMap(
      this.prisma,
      tenantId,
      operationalCustomerIds,
      tenantSites.map((s) => s.id),
    );

    const toRefresh: Array<{ id: string; retainUntil: Date }> = [];
    const toDeleteIds: string[] = [];

    for (const candidate of candidates) {
      const lastActivity =
        candidate.retention_class === CustomerNoteRetentionClass.OPERATIONAL
          ? activityByCustomer.get(candidate.customer_id)
          : undefined;
      if (lastActivity) {
        const refreshedUntil = computeCustomerNoteRetainUntil({
          retentionClass: CustomerNoteRetentionClass.OPERATIONAL,
          now: lastActivity,
          lastCustomerActivityAt: lastActivity,
        });
        if (
          refreshedUntil.getTime() >= now.getTime() &&
          refreshedUntil.getTime() > candidate.retain_until.getTime()
        ) {
          toRefresh.push({ id: candidate.id, retainUntil: refreshedUntil });
          continue;
        }
      }
      toDeleteIds.push(candidate.id);
    }

    if (toRefresh.length > 0) {
      await this.prisma.$transaction(
        toRefresh.map((item) =>
          this.prisma.customerNote.updateMany({
            where: { id: item.id, tenant_id: tenantId },
            data: { retain_until: item.retainUntil },
          }),
        ),
      );
    }

    if (toDeleteIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.customerNote.deleteMany({
      where: {
        tenant_id: tenantId,
        id: { in: toDeleteIds },
        legal_hold: false,
      },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} expired customer notes`);
    }
    return result.count;
  }
}
