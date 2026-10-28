import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationEventType,
  PushDeviceRevokedReason,
  type DisplayLanguage,
  type Prisma,
} from '@prisma/client';
import { DEFAULT_DISPLAY_LANGUAGE } from '../common/i18n/display-language.js';
import { resolveUserLanguage } from '../common/i18n/locale-resolution.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { buildPushMessage } from './push-message.js';
import {
  PushMessagingGateway,
  type PushSendOutcome,
} from './push-messaging.gateway.js';
import { isInQuietHours } from './push-quiet-hours.js';
import { isPushEnabled, PUSH_STALE_MS } from './push.constants.js';

/** The part of a claimed outbox row the push sender needs. */
export interface PushOutboxRow {
  outboxId: string;
  tenantId: string;
  eventType: NotificationEventType;
  recipientUserId: string | null;
  workshopOrderId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}

/** Why a row was not sent. Stored as `suppressed_reason` (ADR-0033 §2). */
export type PushSuppressedReason =
  | 'PUSH_DISABLED'
  | 'STALE'
  | 'RECIPIENT_NOT_ELIGIBLE'
  | 'EVENT_NOT_ENABLED'
  | 'QUIET_HOURS'
  | 'NO_DEVICE';

export type PushDeliveryOutcome =
  | { kind: 'accepted'; acceptedDevices: number }
  | { kind: 'suppressed'; reason: PushSuppressedReason }
  | { kind: 'failed'; code: string; message: string }
  | { kind: 'retry'; code: string; message: string };

const DEFAULT_TIME_ZONE = 'Europe/Vienna';

interface PushOrder {
  orderNumber: string | null;
  siteTimeZone: string | null;
}

/**
 * Sends one PUSH outbox row to every active device of its recipient, inside the worker request (ADR-0033 §2). It
 * decides at send time, not at write time: the kill switch, the 1 hour staleness cut-off, whether the recipient is
 * still an active member (and of the order's site), their event choice and their quiet hours. The caller maps the
 * outcome onto the row; this class never writes the row itself.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly gateway: PushMessagingGateway,
  ) {}

  async deliver(
    row: PushOutboxRow,
    now: Date = new Date(),
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<PushDeliveryOutcome> {
    const checked = precheck(row, now, env);
    if ('kind' in checked) return checked;
    const userId = checked.recipientUserId;

    const isTest = row.eventType === NotificationEventType.PUSH_TEST;
    const access = await this.resolveAccess(row, userId);
    if (!access) {
      return { kind: 'suppressed', reason: 'RECIPIENT_NOT_ELIGIBLE' };
    }
    const order = access.order;

    if (!isTest) {
      const blocked = await this.blockedByPreference(row, userId, order, now);
      if (blocked) return { kind: 'suppressed', reason: blocked };
    }

    const devices = await this.prisma.pushDevice.findMany({
      where: {
        tenant_id: row.tenantId,
        user_id: userId,
        revoked_at: null,
      },
      select: { id: true, fcm_token: true },
    });
    if (devices.length === 0) {
      return { kind: 'suppressed', reason: 'NO_DEVICE' };
    }

    const message = buildPushMessage({
      eventType: row.eventType,
      locale: await this.recipientLocale(row.tenantId, userId),
      orderId: row.workshopOrderId,
      orderNumber: order?.orderNumber ?? null,
      decision: readDecision(row.payload),
    });
    if (!message) {
      return {
        kind: 'failed',
        code: 'EVENT_NOT_PUSHABLE',
        message: 'This event has no push message',
      };
    }

    SideEffectGuard.assertAllowed('PUSH');
    const outcomes = await this.gateway.sendEach(
      devices.map((device) => ({
        deviceId: device.id,
        token: device.fcm_token,
      })),
      message,
    );

    return this.settle(row.tenantId, outcomes);
  }

  /** The user's event choice and quiet hours (not applied to the test push). */
  private async blockedByPreference(
    row: PushOutboxRow,
    userId: string,
    order: PushOrder | null,
    now: Date,
  ): Promise<PushSuppressedReason | null> {
    const preference = await this.prisma.pushPreference.findFirst({
      where: { tenant_id: row.tenantId, user_id: userId },
    });
    if (!preference?.enabled_events.includes(row.eventType)) {
      return 'EVENT_NOT_ENABLED';
    }
    const inQuietHours = isInQuietHours(
      now,
      order?.siteTimeZone ?? DEFAULT_TIME_ZONE,
      preference.quiet_start_min,
      preference.quiet_end_min,
    );
    return inQuietHours ? 'QUIET_HOURS' : null;
  }

  /**
   * Combines the per-device results of one send. Accepted wins; otherwise a transient failure retries; otherwise a
   * rejected message fails the row; otherwise every device was dead (ADR-0033 §2).
   */
  private async settle(
    tenantId: string,
    outcomes: PushSendOutcome[],
  ): Promise<PushDeliveryOutcome> {
    const accepted = outcomes.filter((outcome) => outcome.ok).length;
    // INVALID_ARGUMENT can mean a bad message as well as a bad token. It condemns a device only when the same message
    // reached another device, which proves the message is valid (ADR-0033 §2).
    const dead = outcomes.flatMap((outcome) =>
      !outcome.ok &&
      (outcome.kind === 'unregistered' ||
        (outcome.kind === 'invalid-argument' && accepted > 0))
        ? [outcome.deviceId]
        : [],
    );
    if (dead.length > 0) {
      await this.revokeDevices(tenantId, dead);
    }

    if (accepted > 0) {
      return { kind: 'accepted', acceptedDevices: accepted };
    }
    const transient = outcomes.find(
      (outcome) => !outcome.ok && outcome.kind === 'transient',
    );
    if (transient && !transient.ok) {
      return {
        kind: 'retry',
        code: 'PUSH_PROVIDER_UNAVAILABLE',
        message: `The push provider did not accept the message (${transient.code})`,
      };
    }
    if (outcomes.some((o) => !o.ok && o.kind === 'invalid-argument')) {
      return {
        kind: 'failed',
        code: 'PUSH_MESSAGE_REJECTED',
        message: 'The push provider rejected the message as invalid',
      };
    }
    // Every device was dead and is revoked now: there is nobody left to notify.
    return { kind: 'suppressed', reason: 'NO_DEVICE' };
  }

  /**
   * Whether the recipient is still an active member of an active tenant and, for an order, of the order's site
   * (ADR-0033 §3, checked again at send). The order is read inside the recipient's own sites, so a user who left the
   * site can neither receive its push nor cause its order to be read.
   */
  private async resolveAccess(
    row: PushOutboxRow,
    recipientUserId: string,
  ): Promise<{ order: PushOrder | null } | null> {
    const { tenantId, workshopOrderId } = row;
    const member = await this.systemPrisma.tenantMember.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: recipientUserId,
        is_active: true,
        tenant: { is_active: true },
      },
      select: { id: true },
    });
    if (!member) return null;
    if (!workshopOrderId) return { order: null };

    const memberships = await this.systemPrisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        user_id: recipientUserId,
        is_active: true,
        site: { is_active: true },
      },
      select: { site: { select: { id: true, timezone: true } } },
    });
    const siteIds = memberships.map((membership) => membership.site.id);
    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        id: workshopOrderId,
        tenant_id: tenantId,
        site_id: { in: siteIds },
      },
      select: { order_number: true, site_id: true },
    });
    if (!order) return null;
    const site = memberships.find(
      (membership) => membership.site.id === order.site_id,
    )?.site;
    return {
      order: {
        orderNumber: order.order_number ?? null,
        siteTimeZone: site?.timezone ?? null,
      },
    };
  }

  private async recipientLocale(
    tenantId: string,
    userId: string,
  ): Promise<DisplayLanguage> {
    const [user, tenant] = await Promise.all([
      this.systemPrisma.user.findFirst({
        where: { id: userId },
        select: { locale: true },
      }),
      this.systemPrisma.tenant.findFirst({
        where: { id: tenantId },
        select: { default_locale: true },
      }),
    ]);
    return resolveUserLanguage(
      user?.locale,
      tenant?.default_locale ?? DEFAULT_DISPLAY_LANGUAGE,
    );
  }

  private async revokeDevices(
    tenantId: string,
    deviceIds: string[],
  ): Promise<void> {
    const result = await this.prisma.pushDevice.updateMany({
      where: { tenant_id: tenantId, id: { in: deviceIds }, revoked_at: null },
      data: {
        revoked_at: new Date(),
        revoked_reason: PushDeviceRevokedReason.UNREGISTERED,
      },
    });
    this.logger.log(`Revoked ${result.count} unregistered push devices`);
  }
}

/** What can be decided from the row alone: the kill switch, a missing recipient and a stale push. */
function precheck(
  row: PushOutboxRow,
  now: Date,
  env: NodeJS.ProcessEnv,
): PushDeliveryOutcome | { recipientUserId: string } {
  if (!isPushEnabled(env)) {
    return { kind: 'suppressed', reason: 'PUSH_DISABLED' };
  }
  if (!row.recipientUserId) {
    return {
      kind: 'failed',
      code: 'RECIPIENT_MISSING',
      message: 'The outbox row has no recipient user',
    };
  }
  if (now.getTime() - row.createdAt.getTime() > PUSH_STALE_MS) {
    return { kind: 'suppressed', reason: 'STALE' };
  }
  return { recipientUserId: row.recipientUserId };
}

function readDecision(
  payload: Prisma.JsonValue | null,
): 'APPROVED' | 'DECLINED' | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const decision = (payload as Record<string, unknown>).decision;
  return decision === 'APPROVED' || decision === 'DECLINED' ? decision : null;
}
