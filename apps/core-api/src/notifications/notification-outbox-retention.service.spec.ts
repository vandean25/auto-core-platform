import {
  NOTIFICATION_BODY_RETENTION_MS,
  NotificationOutboxRetentionService,
} from './notification-outbox-retention.service.js';

describe('NotificationOutboxRetentionService', () => {
  const savedMode = process.env.NOTIFICATION_EMAIL_MODE;

  beforeEach(() => {
    process.env.NOTIFICATION_EMAIL_MODE = 'off';
  });

  afterEach(() => {
    if (savedMode === undefined) {
      delete process.env.NOTIFICATION_EMAIL_MODE;
    } else {
      process.env.NOTIFICATION_EMAIL_MODE = savedMode;
    }
  });

  it('does nothing on an instance without sender settings, such as the PDF worker', async () => {
    delete process.env.NOTIFICATION_EMAIL_MODE;
    const prisma = { notificationOutbox: { updateMany: jest.fn() } };
    const systemPrisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
    };
    const requestContext = { runAsWorker: jest.fn() };
    const service = new NotificationOutboxRetentionService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
    );

    await service.purgeBodies();

    expect(systemPrisma.tenant.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('clears bodies of terminal rows older than the retention window, per tenant', async () => {
    const prisma = {
      notificationOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const systemPrisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
    };
    const requestContext = {
      runAsWorker: jest.fn((_t: string, run: () => unknown) => run()),
    };
    const service = new NotificationOutboxRetentionService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
    );

    const before = Date.now();
    await service.purgeBodies();

    const call = prisma.notificationOutbox.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      tenant_id: 'tenant-1',
      body: { not: null },
      body_purged_at: null,
      status: { in: ['ACCEPTED', 'FAILED', 'SUPPRESSED'] },
    });
    const cutoff = call.where.createdAt.lt as Date;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(
      NOTIFICATION_BODY_RETENTION_MS - 1000,
    );
    expect(call.data).toEqual({ body: null, body_purged_at: expect.any(Date) });
  });
});
