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
export class RegistrationIntakeExpiryService {
  private readonly logger = new Logger(RegistrationIntakeExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    @Inject(REGISTRATION_INTAKE_BYTE_STORAGE)
    private readonly byteStorage: RegistrationIntakeByteStorage,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'registration-intake-expiry' })
  async expireUnapplied(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'registration-intake-expiry',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = new Date();
        for (const tenant of tenants) {
          try {
            await this.requestContext.runAsWorker(
              tenant.id,
              () => this.expireForTenant(tenant.id, now),
              { workerId: 'registration-intake-expiry' },
            );
          } catch (cause) {
            this.logger.error(
              `Registration intake expiry failed: ${cause instanceof Error ? cause.message : 'unknown'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  private async expireForTenant(tenantId: string, now: Date): Promise<void> {
    const expired = await this.prisma.registrationDocumentIntake.findMany({
      where: {
        tenant_id: tenantId,
        expires_at: { lt: now },
        state: {
          in: [
            'UPLOADED',
            'QUEUED',
            'RUNNING',
            'AWAITING_REVIEW',
            'FAILED',
            'ABORTED',
          ],
        },
      },
      select: { id: true },
      take: 50,
    });
    for (const row of expired) {
      try {
        await this.byteStorage.deleteIntakePrefix({
          tenantId,
          intakeId: row.id,
        });
      } catch {
        continue;
      }
      await this.prisma.registrationDocumentIntake.deleteMany({
        where: { id: row.id, tenant_id: tenantId },
      });
    }
  }
}
