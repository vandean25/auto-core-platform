import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
  PushDeviceRevokedReason,
  type Prisma,
  type PushDevice,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveSiteContextUser } from '../site/site-session.user.js';
import { wakeUpAfterCommit } from '../workshop/workshop-estimate-email-queue.js';
import type {
  PushDeviceDto,
  PushPreferencesDto,
  PushTestResponseDto,
  RegisterPushDeviceDto,
} from './dto/push.dto.js';
import {
  PUSH_MAX_ACTIVE_DEVICES_PER_USER,
  PUSH_TEST_LIMIT_PER_HOUR,
  PUSH_TEST_WINDOW_MS,
} from './push.constants.js';

/**
 * The `/me/push` API (ADR-0033 §5). Everything is scoped to the caller's own user in the active tenant: a device that
 * belongs to someone else, or to another tenant, is a 404. The FCM token is accepted here and never returned.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly outbox: NotificationOutboxService,
    private readonly wakeUps: NotificationCloudTasksService,
  ) {}

  async listDevices(): Promise<PushDeviceDto[]> {
    const { tenantId, userId } = await this.requireCaller();
    const devices = await this.prisma.pushDevice.findMany({
      where: { tenant_id: tenantId, user_id: userId, revoked_at: null },
      orderBy: { createdAt: 'asc' },
    });
    return devices.map(toDeviceDto);
  }

  /**
   * Registers this browser, or takes over a token that already exists in the tenant (a shared workstation, a user who
   * signed in again). The oldest devices beyond the per-user limit are revoked.
   */
  async registerDevice(dto: RegisterPushDeviceDto): Promise<PushDeviceDto> {
    const { tenantId, userId } = await this.requireCaller();
    const now = new Date();
    const fields = {
      user_id: userId,
      platform: dto.platform,
      browser: dto.browser ?? null,
      installed: dto.installed ?? false,
      last_seen_at: now,
      revoked_at: null,
      revoked_reason: null,
    };
    const device = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.pushDevice.upsert({
        where: {
          tenant_id_fcm_token: { tenant_id: tenantId, fcm_token: dto.token },
        },
        create: { ...fields, tenant_id: tenantId, fcm_token: dto.token },
        update: fields,
      });
      const surplus = await tx.pushDevice.findMany({
        where: { tenant_id: tenantId, user_id: userId, revoked_at: null },
        orderBy: [{ last_seen_at: 'desc' }, { createdAt: 'desc' }],
        skip: PUSH_MAX_ACTIVE_DEVICES_PER_USER,
        select: { id: true },
      });
      if (surplus.length > 0) {
        await tx.pushDevice.updateMany({
          where: {
            tenant_id: tenantId,
            id: { in: surplus.map((row) => row.id) },
          },
          data: {
            revoked_at: now,
            revoked_reason: PushDeviceRevokedReason.REPLACED,
          },
        });
      }
      return saved;
    });
    return toDeviceDto(device);
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const { tenantId, userId } = await this.requireCaller();
    const result = await this.prisma.pushDevice.updateMany({
      where: {
        id: deviceId,
        tenant_id: tenantId,
        user_id: userId,
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
        revoked_reason: PushDeviceRevokedReason.USER,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Push device not found');
    }
  }

  async getPreferences(): Promise<PushPreferencesDto> {
    const { tenantId, userId } = await this.requireCaller();
    const preference = await this.prisma.pushPreference.findFirst({
      where: { tenant_id: tenantId, user_id: userId },
    });
    return {
      enabledEvents: preference?.enabled_events ?? [],
      quietStartMin: preference?.quiet_start_min ?? null,
      quietEndMin: preference?.quiet_end_min ?? null,
    };
  }

  async updatePreferences(
    dto: PushPreferencesDto,
  ): Promise<PushPreferencesDto> {
    const quietStartMin = dto.quietStartMin ?? null;
    const quietEndMin = dto.quietEndMin ?? null;
    if ((quietStartMin === null) !== (quietEndMin === null)) {
      throw new BadRequestException(
        'Quiet hours need both a start and an end, or neither',
      );
    }
    const { tenantId, userId } = await this.requireCaller();
    const data = {
      enabled_events: dto.enabledEvents,
      quiet_start_min: quietStartMin,
      quiet_end_min: quietEndMin,
    };
    await this.prisma.pushPreference.upsert({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
      create: { ...data, tenant_id: tenantId, user_id: userId },
      update: data,
    });
    return { enabledEvents: dto.enabledEvents, quietStartMin, quietEndMin };
  }

  /** Queues a test push to the caller's own devices through the same outbox and worker path (5 per hour). */
  async sendTest(): Promise<PushTestResponseDto> {
    const { tenantId, userId } = await this.requireCaller();
    const now = new Date();

    const devices = await this.prisma.pushDevice.count({
      where: { tenant_id: tenantId, user_id: userId, revoked_at: null },
    });
    if (devices === 0) {
      throw new ConflictException('No push device is registered');
    }

    const occurrenceId = randomUUID();
    const written = await this.prisma.$transaction(async (tx) => {
      // The budget is checked under a lock on this user's preference row, so concurrent requests (also on other
      // instances) are counted one after the other and the hourly cap holds.
      await this.lockUserBudget(tx, tenantId, userId, now);
      const recent = await tx.notificationOutbox.count({
        where: {
          tenant_id: tenantId,
          recipient_user_id: userId,
          channel: NotificationChannel.PUSH,
          event_type: NotificationEventType.PUSH_TEST,
          createdAt: { gte: new Date(now.getTime() - PUSH_TEST_WINDOW_MS) },
        },
      });
      if (recent >= PUSH_TEST_LIMIT_PER_HOUR) {
        throw new HttpException(
          `At most ${PUSH_TEST_LIMIT_PER_HOUR} test pushes per hour`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return this.outbox.enqueueInTx(
        tx,
        {
          tenantId,
          eventType: NotificationEventType.PUSH_TEST,
          occurrenceId,
          channel: NotificationChannel.PUSH,
          recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
          recipientKey: `user:${userId}`,
          recipientUserId: userId,
        },
        now,
      );
    });
    if (written.blocked) {
      throw new ConflictException('The test push was not queued');
    }
    await wakeUpAfterCommit(this.wakeUps, written.id, tenantId);
    return { id: written.id };
  }

  /**
   * Takes a row lock that lasts until the transaction ends: the user's preference row is created if it is missing and
   * then updated, so a second transaction for the same user waits here until the first has committed its outbox row.
   */
  private async lockUserBudget(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    await tx.pushPreference.createMany({
      data: [{ tenant_id: tenantId, user_id: userId, enabled_events: [] }],
      skipDuplicates: true,
    });
    await tx.pushPreference.updateMany({
      where: { tenant_id: tenantId, user_id: userId },
      data: { updatedAt: now },
    });
  }

  private async requireCaller(): Promise<{ tenantId: string; userId: string }> {
    const tenantId = await this.tenantContext.getTenantId();
    const user = await resolveSiteContextUser(
      this.prisma,
      tenantId,
      this.tenantContext.getAuthenticatedUser()?.userId,
    );
    if (!user) {
      throw new ForbiddenException('Active tenant membership is required.');
    }
    return { tenantId, userId: user.id };
  }
}

function toDeviceDto(device: PushDevice): PushDeviceDto {
  return {
    id: device.id,
    platform: device.platform,
    browser: device.browser,
    installed: device.installed,
    lastSeenAt: device.last_seen_at.toISOString(),
    createdAt: device.createdAt.toISOString(),
  };
}
