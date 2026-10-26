import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import {
  REGISTRATION_INTAKE_BYTE_STORAGE,
  type RegistrationIntakeByteStorage,
} from './registration-intake-byte-storage.js';

@Injectable()
export class RegistrationIntakeBytePurgeService {
  private readonly logger = new Logger(RegistrationIntakeBytePurgeService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    @Inject(REGISTRATION_INTAKE_BYTE_STORAGE)
    private readonly byteStorage: RegistrationIntakeByteStorage,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'registration-intake-byte-purge' })
  async purgePending(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'registration-intake-byte-purge',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        for (const tenant of tenants) {
          try {
            await this.requestContext.runAsWorker(
              tenant.id,
              () => this.purgeTenant(tenant.id),
              { workerId: 'registration-intake-byte-purge' },
            );
          } catch (cause) {
            this.logger.error(
              `Registration intake byte purge failed for tenant: ${cause instanceof Error ? cause.message : 'unknown'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  private async purgeTenant(tenantId: string): Promise<void> {
    const pending = await this.prisma.registrationIntakeBytePurge.findMany({
      where: { tenant_id: tenantId, processed_at: null },
      orderBy: { created_at: 'asc' },
      take: 20,
    });
    for (const row of pending) {
      const claimed = await this.prisma.registrationIntakeBytePurge.updateMany({
        where: {
          id: row.id,
          processed_at: null,
          attempts: row.attempts,
        },
        data: { attempts: row.attempts + 1 },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.byteStorage.deleteIntakePrefix({
          tenantId,
          intakeId: row.intake_id,
        });
        await this.prisma.registrationIntakeBytePurge.updateMany({
          where: { id: row.id, processed_at: null },
          data: { processed_at: new Date(), last_error: null },
        });
      } catch (error) {
        await this.prisma.registrationIntakeBytePurge.updateMany({
          where: { id: row.id, processed_at: null },
          data: {
            last_error:
              error instanceof Error
                ? error.message.slice(0, 512)
                : 'delete failed',
          },
        });
      }
    }
  }
}
