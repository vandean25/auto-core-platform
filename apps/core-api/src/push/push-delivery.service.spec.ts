import { NotificationEventType } from '@prisma/client';
import {
  PushDeliveryService,
  type PushOutboxRow,
} from './push-delivery.service.js';
import {
  PushMessagingGateway,
  type PushSendOutcome,
  type PushSendTarget,
} from './push-messaging.gateway.js';
import { PUSH_DATA_KEYS, type PushData } from './push-message.js';

const NOW = new Date('2026-12-01T12:00:00.000Z'); // 13:00 in Vienna
const ENV_ON = { PUSH_ENABLED: 'true' } as NodeJS.ProcessEnv;

const row = (overrides: Partial<PushOutboxRow> = {}): PushOutboxRow => ({
  outboxId: 'outbox-1',
  tenantId: 'tenant-1',
  eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
  recipientUserId: 'user-1',
  workshopOrderId: 'order-1',
  payload: { decision: 'APPROVED' },
  createdAt: new Date(NOW.getTime() - 60_000),
  ...overrides,
});

class FakeGateway extends PushMessagingGateway {
  sent: Array<{ targets: PushSendTarget[]; message: PushData }> = [];
  outcome: (targets: PushSendTarget[]) => PushSendOutcome[] = (targets) =>
    targets.map((target) => ({ deviceId: target.deviceId, ok: true }));

  sendEach(targets: PushSendTarget[], message: PushData) {
    this.sent.push({ targets, message });
    return Promise.resolve(this.outcome(targets));
  }
}

function setup() {
  const prisma = {
    workshopOrder: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ order_number: 'WO-2026-0007', site_id: 'site-1' }),
    },
    pushPreference: {
      findFirst: jest.fn().mockResolvedValue({
        enabled_events: [NotificationEventType.CUSTOMER_ESTIMATE_DECIDED],
        quiet_start_min: null,
        quiet_end_min: null,
      }),
    },
    pushDevice: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'device-1', fcm_token: 'token-1' },
        { id: 'device-2', fcm_token: 'token-2' },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const systemPrisma = {
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    siteMembership: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { site: { id: 'site-1', timezone: 'Europe/Vienna' } },
        ]),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ locale: null }) },
    tenant: {
      findFirst: jest.fn().mockResolvedValue({ default_locale: 'de' }),
    },
  };
  const gateway = new FakeGateway();
  const service = new PushDeliveryService(
    prisma as never,
    systemPrisma as never,
    gateway,
  );
  return { service, prisma, systemPrisma, gateway };
}

describe('PushDeliveryService', () => {
  it('sends nothing while the kill switch is off', async () => {
    const { service, gateway, prisma } = setup();

    await expect(
      service.deliver(row(), NOW, {} as NodeJS.ProcessEnv),
    ).resolves.toEqual({ kind: 'suppressed', reason: 'PUSH_DISABLED' });
    await expect(
      service.deliver(row(), NOW, { PUSH_ENABLED: 'yes' } as NodeJS.ProcessEnv),
    ).resolves.toEqual({ kind: 'suppressed', reason: 'PUSH_DISABLED' });

    expect(gateway.sent).toHaveLength(0);
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
  });

  it('suppresses a push older than one hour and sends one just inside it', async () => {
    const { service, gateway } = setup();

    await expect(
      service.deliver(
        row({ createdAt: new Date(NOW.getTime() - 60 * 60 * 1000 - 1) }),
        NOW,
        ENV_ON,
      ),
    ).resolves.toEqual({ kind: 'suppressed', reason: 'STALE' });
    await expect(
      service.deliver(
        row({ createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
        NOW,
        ENV_ON,
      ),
    ).resolves.toMatchObject({ kind: 'accepted' });
    expect(gateway.sent).toHaveLength(1);
  });

  it('fails a row that has no recipient', async () => {
    const { service } = setup();
    await expect(
      service.deliver(row({ recipientUserId: null }), NOW, ENV_ON),
    ).resolves.toMatchObject({ kind: 'failed', code: 'RECIPIENT_MISSING' });
  });

  it('suppresses when the recipient is no longer an active member, or no longer of the order site', async () => {
    const left = setup();
    left.systemPrisma.tenantMember.findFirst.mockResolvedValue(null);
    await expect(left.service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'suppressed',
      reason: 'RECIPIENT_NOT_ELIGIBLE',
    });

    const moved = setup();
    moved.systemPrisma.siteMembership.findMany.mockResolvedValue([]);
    moved.prisma.workshopOrder.findFirst.mockResolvedValue(null);
    await expect(moved.service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'suppressed',
      reason: 'RECIPIENT_NOT_ELIGIBLE',
    });
    expect(left.gateway.sent).toHaveLength(0);
    expect(moved.gateway.sent).toHaveLength(0);
  });

  it('suppresses an event the user did not switch on, or without any preference', async () => {
    const off = setup();
    off.prisma.pushPreference.findFirst.mockResolvedValue({
      enabled_events: [NotificationEventType.WORKSHOP_ORDER_READY],
      quiet_start_min: null,
      quiet_end_min: null,
    });
    await expect(off.service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'suppressed',
      reason: 'EVENT_NOT_ENABLED',
    });

    const none = setup();
    none.prisma.pushPreference.findFirst.mockResolvedValue(null);
    await expect(none.service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'suppressed',
      reason: 'EVENT_NOT_ENABLED',
    });
  });

  it('suppresses inside quiet hours of the site time zone, overnight windows included', async () => {
    const { service, prisma, gateway } = setup();
    prisma.pushPreference.findFirst.mockResolvedValue({
      enabled_events: [NotificationEventType.CUSTOMER_ESTIMATE_DECIDED],
      quiet_start_min: 22 * 60,
      quiet_end_min: 6 * 60,
    });

    // 23:30 UTC is 00:30 in Vienna: quiet.
    await expect(
      service.deliver(
        row({ createdAt: new Date('2026-12-01T23:25:00.000Z') }),
        new Date('2026-12-01T23:30:00.000Z'),
        ENV_ON,
      ),
    ).resolves.toEqual({ kind: 'suppressed', reason: 'QUIET_HOURS' });
    // 12:00 UTC is 13:00 in Vienna: not quiet.
    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toMatchObject({
      kind: 'accepted',
    });
    expect(gateway.sent).toHaveLength(1);
  });

  it('sends a test push regardless of the event choice and the quiet hours', async () => {
    const { service, prisma, gateway } = setup();
    prisma.pushPreference.findFirst.mockResolvedValue({
      enabled_events: [],
      quiet_start_min: 0,
      quiet_end_min: 1439,
    });

    const outcome = await service.deliver(
      row({
        eventType: NotificationEventType.PUSH_TEST,
        workshopOrderId: null,
        payload: null,
      }),
      NOW,
      ENV_ON,
    );

    expect(outcome).toEqual({ kind: 'accepted', acceptedDevices: 2 });
    expect(gateway.sent[0].message).toMatchObject({
      title: 'Testbenachrichtigung',
      eventType: 'PUSH_TEST',
    });
    expect(prisma.pushPreference.findFirst).not.toHaveBeenCalled();
  });

  it('suppresses when the user has no active device', async () => {
    const { service, prisma } = setup();
    prisma.pushDevice.findMany.mockResolvedValue([]);
    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'suppressed',
      reason: 'NO_DEVICE',
    });
  });

  it('is accepted when one device accepts, and revokes the device that is unregistered', async () => {
    const { service, prisma, gateway } = setup();
    gateway.outcome = (targets) => [
      { deviceId: targets[0].deviceId, ok: true },
      {
        deviceId: targets[1].deviceId,
        ok: false,
        kind: 'unregistered',
        code: 'messaging/registration-token-not-registered',
      },
    ];

    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'accepted',
      acceptedDevices: 1,
    });
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        id: { in: ['device-2'] },
        revoked_at: null,
      },
      data: { revoked_at: expect.any(Date), revoked_reason: 'UNREGISTERED' },
    });
  });

  it('retries when no device accepted and the failure is transient', async () => {
    const { service, prisma, gateway } = setup();
    gateway.outcome = (targets) =>
      targets.map((target) => ({
        deviceId: target.deviceId,
        ok: false as const,
        kind: 'transient' as const,
        code: 'messaging/server-unavailable',
      }));

    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toMatchObject({
      kind: 'retry',
      code: 'PUSH_PROVIDER_UNAVAILABLE',
    });
    expect(prisma.pushDevice.updateMany).not.toHaveBeenCalled();
  });

  it('revokes an invalid-argument device only when another device accepted the same message', async () => {
    const { service, prisma, gateway } = setup();
    gateway.outcome = (targets) => [
      { deviceId: targets[0].deviceId, ok: true },
      {
        deviceId: targets[1].deviceId,
        ok: false,
        kind: 'invalid-argument',
        code: 'messaging/invalid-argument',
      },
    ];

    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toMatchObject({
      kind: 'accepted',
    });
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['device-2'] } }),
      }),
    );
  });

  it('fails the row and revokes nothing when every device answers invalid-argument', async () => {
    const { service, prisma, gateway } = setup();
    gateway.outcome = (targets) =>
      targets.map((target) => ({
        deviceId: target.deviceId,
        ok: false as const,
        kind: 'invalid-argument' as const,
        code: 'messaging/invalid-argument',
      }));

    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toMatchObject({
      kind: 'failed',
      code: 'PUSH_MESSAGE_REJECTED',
    });
    expect(prisma.pushDevice.updateMany).not.toHaveBeenCalled();
  });

  it('suppresses with no device left when every token was dead', async () => {
    const { service, prisma, gateway } = setup();
    gateway.outcome = (targets) =>
      targets.map((target) => ({
        deviceId: target.deviceId,
        ok: false as const,
        kind: 'unregistered' as const,
        code: 'messaging/registration-token-not-registered',
      }));

    await expect(service.deliver(row(), NOW, ENV_ON)).resolves.toEqual({
      kind: 'suppressed',
      reason: 'NO_DEVICE',
    });
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['device-1', 'device-2'] },
        }),
      }),
    );
  });

  it('sends a localized message with only the allowlisted keys, in the language of the recipient', async () => {
    const { service, systemPrisma, gateway } = setup();
    systemPrisma.user.findFirst.mockResolvedValue({ locale: 'en' });

    await service.deliver(row(), NOW, ENV_ON);

    const { message, targets } = gateway.sent[0];
    expect(message).toEqual({
      title: 'Estimate approved',
      body: 'Order WO-2026-0007',
      eventType: 'CUSTOMER_ESTIMATE_DECIDED',
      orderId: 'order-1',
      url: '/workshop/orders/order-1',
      tag: 'CUSTOMER_ESTIMATE_DECIDED:order-1',
    });
    for (const key of Object.keys(message)) {
      expect(PUSH_DATA_KEYS).toContain(key);
    }
    expect(targets).toEqual([
      { deviceId: 'device-1', token: 'token-1' },
      { deviceId: 'device-2', token: 'token-2' },
    ]);
  });

  it('scopes every lookup to the tenant of the row', async () => {
    const { service, prisma, systemPrisma } = setup();

    await service.deliver(row(), NOW, ENV_ON);

    expect(prisma.pushPreference.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', user_id: 'user-1' },
    });
    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1', user_id: 'user-1', revoked_at: null },
      }),
    );
    expect(systemPrisma.tenantMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: 'tenant-1' }),
      }),
    );
    expect(systemPrisma.siteMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-1',
          user_id: 'user-1',
          is_active: true,
        }),
      }),
    );
    expect(prisma.workshopOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-1',
          tenant_id: 'tenant-1',
          site_id: { in: ['site-1'] },
        },
      }),
    );
  });
});
