import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PushDeviceRevokedReason } from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  PUSH_DEVICE_IDLE_MS,
  PUSH_REVOKED_RETENTION_MS,
} from './push.constants.js';

/**
 * Daily device cleanup (ADR-0033 §4). Revokes devices not seen for 60 days and devices of users who are no longer
 * active members, then deletes rows revoked more than 30 days ago. It never sends anything. Runs per tenant under a
 * worker context, like the notification retention job.
 */
@Injectable()
export class PushDeviceCleanupService {
  private readonly logger = new Logger(PushDeviceCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron('37 3 * * *', { name: 'push-device-cleanup' })
  async cleanUp(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'push-device-cleanup',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = new Date();
        for (const { id: tenantId } of tenants) {
          try {
            await this.requestContext.runAsWorker(
              tenantId,
              () => this.cleanUpTenant(tenantId, now),
              { workerId: 'push-device-cleanup' },
            );
          } catch (cause) {
            // One tenant's failure must not skip the tenants after it; the next night retries it.
            this.logger.error(
              `Push device cleanup failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
            );
          }
        }
      },
      this.logger,
    );
  }

  private async cleanUpTenant(tenantId: string, now: Date): Promise<void> {
    const idle = await this.revoke(
      tenantId,
      now,
      PushDeviceRevokedReason.STALE,
      { last_seen_at: { lt: new Date(now.getTime() - PUSH_DEVICE_IDLE_MS) } },
    );
    const ended = await this.revokeEndedMemberships(tenantId, now);
    const deleted = await this.prisma.pushDevice.deleteMany({
      where: {
        tenant_id: tenantId,
        revoked_at: { lt: new Date(now.getTime() - PUSH_REVOKED_RETENTION_MS) },
      },
    });
    if (idle + ended + deleted.count > 0) {
      this.logger.log(
        `Push devices for one tenant: ${idle} idle revoked, ${ended} membership ended, ${deleted.count} deleted`,
      );
    }
  }

  private async revokeEndedMemberships(
    tenantId: string,
    now: Date,
  ): Promise<number> {
    const holders = await this.prisma.pushDevice.groupBy({
      by: ['user_id'],
      where: { tenant_id: tenantId, revoked_at: null },
    });
    if (holders.length === 0) return 0;
    const userIds = holders.map((holder) => holder.user_id);
    const members = await this.systemPrisma.tenantMember.findMany({
      where: { tenant_id: tenantId, user_id: { in: userIds }, is_active: true },
      select: { user_id: true },
    });
    const active = new Set(members.map((member) => member.user_id));
    const gone = userIds.filter((userId) => !active.has(userId));
    if (gone.length === 0) return 0;
    return this.revoke(
      tenantId,
      now,
      PushDeviceRevokedReason.MEMBERSHIP_ENDED,
      { user_id: { in: gone } },
    );
  }

  private async revoke(
    tenantId: string,
    now: Date,
    reason: PushDeviceRevokedReason,
    match: { last_seen_at: { lt: Date } } | { user_id: { in: string[] } },
  ): Promise<number> {
    const result = await this.prisma.pushDevice.updateMany({
      where: { tenant_id: tenantId, revoked_at: null, ...match },
      data: { revoked_at: now, revoked_reason: reason },
    });
    return result.count;
  }
}
