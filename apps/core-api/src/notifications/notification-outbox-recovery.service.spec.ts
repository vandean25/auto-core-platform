import { NotificationOutboxRecoveryService } from './notification-outbox-recovery.service.js';

describe('NotificationOutboxRecoveryService', () => {
  let prisma: {
    notificationOutbox: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let systemPrisma: { tenant: { findMany: jest.Mock } };
  let requestContext: { runAsWorker: jest.Mock };
  let wakeUps: { isEnabled: jest.Mock; enqueueWakeUp: jest.Mock };
  let service: NotificationOutboxRecoveryService;

  /** The writes in call order: the stale-unsent pass is always first, then one write per row touched. */
  const writes = () =>
    prisma.notificationOutbox.updateMany.mock.calls.map(([arg]) => arg);

  beforeEach(() => {
    prisma = {
      notificationOutbox: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    systemPrisma = {
      tenant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'tenant-1', is_active: true }]),
      },
    };
    requestContext = {
      runAsWorker: jest.fn((_tenantId: string, run: () => unknown) => run()),
    };
    wakeUps = {
      isEnabled: jest.fn().mockReturnValue(true),
      enqueueWakeUp: jest.fn().mockResolvedValue(undefined),
    };
    service = new NotificationOutboxRecoveryService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
      wakeUps as never,
    );
  });

  it('fails notices that waited past the sending window, before any wake-up', async () => {
    await service.recover();

    expect(writes()[0]).toMatchObject({
      where: { tenant_id: 'tenant-1', status: 'PENDING' },
      data: {
        status: 'FAILED',
        last_error_code: 'STALE_UNSENT',
        lease_token: null,
      },
    });
    expect(writes()[0].where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('keeps the database passes running while the queue is off, but wakes nothing', async () => {
    wakeUps.isEnabled.mockReturnValue(false);
    prisma.notificationOutbox.findMany.mockResolvedValueOnce([
      { id: 'outbox-5', attempts: 2 },
    ]);

    await service.recover();

    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
    expect(prisma.notificationOutbox.findMany).toHaveBeenCalledTimes(1);
    expect(writes()[1]).toMatchObject({
      data: { status: 'PENDING', last_error_code: 'LEASE_EXPIRED' },
    });
  });

  it('wakes due pending rows, scoped to the tenant', async () => {
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([{ id: 'outbox-1' }])
      .mockResolvedValueOnce([]);

    await service.recover();

    expect(
      prisma.notificationOutbox.findMany.mock.calls[0][0].where,
    ).toMatchObject({
      tenant_id: 'tenant-1',
      status: 'PENDING',
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
    });
  });

  it('moves the due time of a woken row to now, so the next sweep waits a full grace again', async () => {
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([{ id: 'outbox-6' }])
      .mockResolvedValueOnce([]);

    await service.recover();

    expect(writes()[1]).toMatchObject({
      where: { id: 'outbox-6', tenant_id: 'tenant-1', status: 'PENDING' },
      data: { next_attempt_at: expect.any(Date) },
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-6',
      tenantId: 'tenant-1',
    });
  });

  it('does not wake a row that was claimed before the wake-up could be recorded', async () => {
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([{ id: 'outbox-7' }])
      .mockResolvedValueOnce([]);
    prisma.notificationOutbox.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    await service.recover();

    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('releases an expired claim with attempts left and wakes it again', async () => {
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'outbox-2', attempts: 2 }]);

    await service.recover();

    expect(writes()[1]).toMatchObject({
      data: {
        status: 'PENDING',
        last_error_code: 'LEASE_EXPIRED',
        last_error_message: 'The delivery attempt did not finish in time',
        lease_token: null,
      },
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-2',
      tenantId: 'tenant-1',
      delaySeconds: 300,
    });
  });

  it('fails an expired claim that used every attempt, without waking it', async () => {
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'outbox-3', attempts: 5 }]);

    await service.recover();

    expect(writes()[1]).toMatchObject({
      data: { status: 'FAILED', last_error_code: 'LEASE_EXPIRED' },
    });
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('keeps the database passes for a suspended tenant, but wakes none of its rows', async () => {
    systemPrisma.tenant.findMany.mockResolvedValueOnce([
      { id: 'tenant-1', is_active: false },
    ]);
    prisma.notificationOutbox.findMany.mockResolvedValueOnce([
      { id: 'outbox-8', attempts: 2 },
    ]);

    await service.recover();

    expect(writes()[0]).toMatchObject({
      data: { last_error_code: 'STALE_UNSENT' },
    });
    expect(writes()[1]).toMatchObject({
      data: { status: 'PENDING', last_error_code: 'LEASE_EXPIRED' },
    });
    // Only the expired-claim query ran: the due-row wake-up query is skipped for a suspended tenant.
    expect(prisma.notificationOutbox.findMany).toHaveBeenCalledTimes(1);
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('schedules a released claim after its backoff, not at once', async () => {
    const before = Date.now();
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'outbox-10', attempts: 2 }]);

    await service.recover();

    const dueAt: Date = writes()[1].data.next_attempt_at;
    expect(dueAt.getTime()).toBeGreaterThanOrEqual(before + 300_000);
    expect(dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: 'outbox-10', delaySeconds: 300 }),
    );
  });

  it('does not wake a claim that another sweep already released', async () => {
    prisma.notificationOutbox.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'outbox-4', attempts: 2 }]);
    prisma.notificationOutbox.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    await service.recover();

    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });
});
