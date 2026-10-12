import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationOutboxStatus } from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { NotificationCloudTasksService } from './notification-cloud-tasks.service.js';
import { NOTIFICATION_MAX_ATTEMPTS } from './notification-retry.policy.js';

/**
 * A PENDING row is only re-woken after this grace, so a normal dispatch has time to claim it. A
 * duplicate wake-up is harmless because claims are atomic; the grace only limits queue traffic.
 */
export const NOTIFICATION_WAKE_GRACE_MS = 5 * 60_000;
/**
 * A PENDING row still unsent after this long never reached a worker: the retry schedule ends about 81
 * minutes after the first attempt. Such a notice is failed, not sent late.
 */
export const NOTIFICATION_UNSENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECOVERY_BATCH = 100;

/**
 * Lost-wake-up sweep (AUT-356). Each minute, per tenant under a worker context, it fails notices that
 * waited too long, releases claims whose lease expired, and wakes due rows that no task picked up.
 * The database passes run even while the queue is off, so no lease is left stuck and no notice waits
 * forever; only the wake-ups need the queue. Claims are atomic, so a duplicate wake-up is harmless.
 * Same tenant-loop pattern as the document-branding recovery sweeps: no SystemPrisma delegate for
 * outbox rows.
 */
@Injectable()
export class NotificationOutboxRecoveryService {
  private readonly logger = new Logger(NotificationOutboxRecoveryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly wakeUps: NotificationCloudTasksService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'notification-outbox-recovery',
  })
  async recover(): Promise<void> {
    // A slow run must not stack a second sweep on top of it; the next minute picks up the rest.
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const wakeEnabled = this.wakeUps.isEnabled();
      const tenants = await this.systemPrisma.tenant.findMany({
        select: { id: true },
      });
      const now = new Date();
      for (const { id: tenantId } of tenants) {
        try {
          await this.requestContext.runAsWorker(
            tenantId,
            () => this.recoverForTenant(tenantId, now, wakeEnabled),
            { workerId: 'notification-outbox-recovery' },
          );
        } catch (cause) {
          // One tenant's failure must not skip the tenants after it.
          this.logger.error(
            `Notification recovery failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async recoverForTenant(
    tenantId: string,
    now: Date,
    wakeEnabled: boolean,
  ): Promise<void> {
    await this.failStaleUnsent(tenantId, now);
    if (wakeEnabled) {
      await this.wakeDueRows(tenantId, now);
    }
    await this.releaseExpiredClaims(tenantId, now, wakeEnabled);
  }

  /** Fails notices that waited past the window. Runs before the wake-ups, so they are never sent late. */
  private async failStaleUnsent(tenantId: string, now: Date): Promise<void> {
    const failed = await this.prisma.notificationOutbox.updateMany({
      where: {
        tenant_id: tenantId,
        status: NotificationOutboxStatus.PENDING,
        createdAt: {
          lt: new Date(now.getTime() - NOTIFICATION_UNSENT_WINDOW_MS),
        },
      },
      data: {
        status: NotificationOutboxStatus.FAILED,
        failed_at: now,
        last_error_code: 'STALE_UNSENT',
        last_error_message: 'The notice was not sent within the sending window',
        lease_token: null,
        lease_expires_at: null,
      },
    });
    if (failed.count > 0) {
      this.logger.warn(
        `Failed ${failed.count} unsent notifications past the sending window for one tenant`,
      );
    }
  }

  private async wakeDueRows(tenantId: string, now: Date): Promise<void> {
    const overdueBefore = new Date(now.getTime() - NOTIFICATION_WAKE_GRACE_MS);
    const due = await this.prisma.notificationOutbox.findMany({
      where: {
        tenant_id: tenantId,
        status: NotificationOutboxStatus.PENDING,
        next_attempt_at: { lte: overdueBefore },
      },
      select: { id: true },
      take: RECOVERY_BATCH,
      orderBy: { next_attempt_at: 'asc' },
    });
    for (const row of due) {
      // Moving the due time to now means the next sweep waits a full grace again, so a backlog is not
      // re-woken every minute. A row claimed in the meantime is left alone.
      const touched = await this.prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          tenant_id: tenantId,
          status: NotificationOutboxStatus.PENDING,
          next_attempt_at: { lte: overdueBefore },
        },
        data: { next_attempt_at: now },
      });
      if (touched.count === 1) {
        await this.wake(row.id, tenantId);
      }
    }
  }

  private async releaseExpiredClaims(
    tenantId: string,
    now: Date,
    wakeEnabled: boolean,
  ): Promise<void> {
    const expired = await this.prisma.notificationOutbox.findMany({
      where: {
        tenant_id: tenantId,
        status: NotificationOutboxStatus.SENDING,
        lease_expires_at: { lt: now },
      },
      select: { id: true, attempts: true },
      take: RECOVERY_BATCH,
      orderBy: { lease_expires_at: 'asc' },
    });
    for (const row of expired) {
      const exhausted = row.attempts >= NOTIFICATION_MAX_ATTEMPTS;
      const released = await this.prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          tenant_id: tenantId,
          status: NotificationOutboxStatus.SENDING,
          lease_expires_at: { lt: now },
        },
        data: exhausted
          ? {
              status: NotificationOutboxStatus.FAILED,
              failed_at: now,
              last_error_code: 'LEASE_EXPIRED',
              last_error_message: 'The delivery attempt did not finish in time',
              lease_token: null,
              lease_expires_at: null,
            }
          : {
              status: NotificationOutboxStatus.PENDING,
              next_attempt_at: now,
              last_error_code: 'LEASE_EXPIRED',
              lease_token: null,
              lease_expires_at: null,
            },
      });
      if (released.count === 1 && !exhausted && wakeEnabled) {
        await this.wake(row.id, tenantId);
      }
    }
  }

  private async wake(outboxId: string, tenantId: string): Promise<void> {
    await this.wakeUps
      .enqueueWakeUp({ outboxId, tenantId })
      .catch((cause: unknown) =>
        this.logger.warn(
          `Could not wake notification ${outboxId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
        ),
      );
  }
}
