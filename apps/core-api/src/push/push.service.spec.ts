import { HttpException } from '@nestjs/common';
import { PushService } from './push.service.js';

function setup() {
  const prisma: Record<string, any> = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        firebaseUid: 'uid-1',
        active_site_id: null,
      }),
    },
    tenantMember: { findFirst: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    pushDevice: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pushPreference: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notificationOutbox: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'uid-1' }),
  };
  const outbox = {
    enqueueInTx: jest
      .fn()
      .mockResolvedValue({ blocked: false, id: 'outbox-1', created: true }),
  };
  const wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };
  const service = new PushService(
    prisma as never,
    tenantContext as never,
    outbox as never,
    wakeUps as never,
  );
  return { service, prisma, tenantContext, outbox, wakeUps };
}

const device = {
  id: 'device-1',
  platform: 'DESKTOP',
  browser: 'chrome',
  installed: false,
  fcm_token: 'secret-token',
  last_seen_at: new Date('2026-10-28T10:00:00.000Z'),
  createdAt: new Date('2026-10-28T09:00:00.000Z'),
};

describe('PushService', () => {
  it('refuses a caller without an active membership', async () => {
    const { service, prisma } = setup();
    prisma.tenantMember.findFirst.mockResolvedValue(null);
    await expect(service.listDevices()).rejects.toThrow(
      'Active tenant membership is required.',
    );
  });

  it("lists only the caller's active devices and never returns the token", async () => {
    const { service, prisma } = setup();
    prisma.pushDevice.findMany.mockResolvedValue([device]);

    const result = await service.listDevices();

    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1', user_id: 'user-1', revoked_at: null },
      }),
    );
    expect(result).toEqual([
      {
        id: 'device-1',
        platform: 'DESKTOP',
        browser: 'chrome',
        installed: false,
        lastSeenAt: '2026-10-28T10:00:00.000Z',
        createdAt: '2026-10-28T09:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('registers a token for the caller, taking over an existing one, and revokes devices beyond the limit', async () => {
    const { service, prisma } = setup();
    prisma.pushDevice.upsert.mockResolvedValue(device);
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'old-1' },
      { id: 'old-2' },
    ]);

    await service.registerDevice({
      token: 'secret-token',
      platform: 'DESKTOP',
      browser: 'chrome',
    } as never);

    const upsert = prisma.pushDevice.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({
      tenant_id_fcm_token: { tenant_id: 'tenant-1', fcm_token: 'secret-token' },
    });
    expect(upsert.update).toMatchObject({
      user_id: 'user-1',
      revoked_at: null,
      revoked_reason: null,
    });
    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10 }),
    );
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', id: { in: ['old-1', 'old-2'] } },
      data: { revoked_at: expect.any(Date), revoked_reason: 'REPLACED' },
    });
  });

  it("revokes only the caller's own device, and answers 404 for anything else", async () => {
    const { service, prisma } = setup();
    await service.revokeDevice('device-1');
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'device-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        revoked_at: null,
      },
      data: { revoked_at: expect.any(Date), revoked_reason: 'USER' },
    });

    prisma.pushDevice.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revokeDevice('device-9')).rejects.toThrow(
      'Push device not found',
    );
  });

  it('returns empty preferences by default and stores the quiet hours', async () => {
    const { service, prisma } = setup();
    await expect(service.getPreferences()).resolves.toEqual({
      enabledEvents: [],
      quietStartMin: null,
      quietEndMin: null,
    });

    await service.updatePreferences({
      enabledEvents: ['CUSTOMER_ESTIMATE_DECIDED'],
      quietStartMin: 1320,
      quietEndMin: 360,
    });
    expect(prisma.pushPreference.upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_user_id: { tenant_id: 'tenant-1', user_id: 'user-1' },
      },
      create: {
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        enabled_events: ['CUSTOMER_ESTIMATE_DECIDED'],
        quiet_start_min: 1320,
        quiet_end_min: 360,
      },
      update: {
        enabled_events: ['CUSTOMER_ESTIMATE_DECIDED'],
        quiet_start_min: 1320,
        quiet_end_min: 360,
      },
    });
  });

  it('refuses quiet hours with only one end', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updatePreferences({
        enabledEvents: [],
        quietStartMin: 60,
        quietEndMin: null,
      }),
    ).rejects.toThrow('Quiet hours need both a start and an end');
    expect(prisma.pushPreference.upsert).not.toHaveBeenCalled();
  });

  it('queues a test push for the caller in one outbox write and wakes the worker after commit', async () => {
    const { service, prisma, outbox, wakeUps } = setup();

    await expect(service.sendTest()).resolves.toEqual({ id: 'outbox-1' });

    // The budget is taken under a row lock of this user, before it is counted.
    expect(prisma.pushPreference.createMany).toHaveBeenCalledWith({
      data: [{ tenant_id: 'tenant-1', user_id: 'user-1', enabled_events: [] }],
      skipDuplicates: true,
    });
    expect(prisma.pushPreference.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', user_id: 'user-1' },
      data: { updatedAt: expect.any(Date) },
    });

    expect(outbox.enqueueInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventType: 'PUSH_TEST',
        channel: 'PUSH',
        recipientKey: 'user:user-1',
        recipientUserId: 'user-1',
      }),
      expect.any(Date),
    );
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
    });
  });

  it('limits test pushes to five per hour and needs a registered device', async () => {
    const { service, prisma, outbox } = setup();
    prisma.notificationOutbox.count.mockResolvedValue(5);
    await expect(service.sendTest()).rejects.toBeInstanceOf(HttpException);
    await expect(service.sendTest()).rejects.toMatchObject({ status: 429 });
    expect(outbox.enqueueInTx).not.toHaveBeenCalled();

    prisma.notificationOutbox.count.mockResolvedValue(0);
    prisma.pushDevice.count.mockResolvedValue(0);
    await expect(service.sendTest()).rejects.toMatchObject({ status: 409 });
  });
});
