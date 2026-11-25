import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestContextService } from '../../common/services/request-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';

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
    const result = await this.prisma.customerNote.deleteMany({
      where: {
        tenant_id: tenantId,
        legal_hold: false,
        retain_until: { lt: now },
      },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} expired customer notes`);
    }
    return result.count;
  }
}
