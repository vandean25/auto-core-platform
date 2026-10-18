import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';
import {
  NOTIFICATION_BODY_RETENTION_MS,
  NotificationOutboxRetentionService,
} from './notification-outbox-retention.service.js';

describe('NotificationOutboxRetentionService', () => {
  it('purges bodies on any instance, since the purge sends nothing', async () => {
    const prisma = {
      notificationOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const systemPrisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
      ...cronJobLockTestStub(),
    };
    const requestContext = {
      runAsWorker: jest.fn((_t: string, run: () => unknown) => run()),
    };
    const service = new NotificationOutboxRetentionService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
    );

    await service.purgeBodies();

    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalled();
  });

  it('clears bodies of terminal rows older than the retention window, per tenant', async () => {
    const prisma = {
      notificationOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const systemPrisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
      ...cronJobLockTestStub(),
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
