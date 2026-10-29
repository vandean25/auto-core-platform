import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';
import { PushDeviceCleanupService } from './push-device-cleanup.service.js';
import {
  PUSH_DEVICE_IDLE_MS,
  PUSH_REVOKED_RETENTION_MS,
} from './push.constants.js';

function setup(activeMembers: string[] = ['user-1']) {
  const prisma = {
    pushDevice: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest
        .fn()
        .mockResolvedValue([{ user_id: 'user-1' }, { user_id: 'user-2' }]),
    },
  };
  const systemPrisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
    tenantMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(activeMembers.map((user_id) => ({ user_id }))),
    },
    ...cronJobLockTestStub(),
  };
  const requestContext = {
    runAsWorker: jest.fn((_t: string, run: () => unknown) => run()),
  };
  const service = new PushDeviceCleanupService(
    prisma as never,
    systemPrisma as never,
    requestContext as never,
  );
  return { service, prisma, systemPrisma, requestContext };
}

describe('PushDeviceCleanupService', () => {
  it('revokes idle devices and devices of departed members, and deletes old revoked rows, per tenant', async () => {
    const { service, prisma, requestContext } = setup(['user-1']);

    const before = Date.now();
    await service.run();

    expect(requestContext.runAsWorker).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(Function),
      { workerId: 'push-device-cleanup' },
    );
    const [idle, ended] = prisma.pushDevice.updateMany.mock.calls.map(
      (call) => call[0],
    );
    expect(idle.where).toMatchObject({
      tenant_id: 'tenant-1',
      revoked_at: null,
    });
    expect(idle.where.last_seen_at.lt.getTime()).toBeGreaterThanOrEqual(
      before - PUSH_DEVICE_IDLE_MS,
    );
    expect(idle.data.revoked_reason).toBe('STALE');
    expect(ended.where).toMatchObject({
      tenant_id: 'tenant-1',
      revoked_at: null,
      user_id: { in: ['user-2'] },
    });
    expect(ended.data.revoked_reason).toBe('MEMBERSHIP_ENDED');
    const purge = prisma.pushDevice.deleteMany.mock.calls[0][0];
    expect(purge.where.tenant_id).toBe('tenant-1');
    expect(purge.where.revoked_at.lt.getTime()).toBeGreaterThanOrEqual(
      before - PUSH_REVOKED_RETENTION_MS,
    );
  });

  it('skips the membership revoke when every holder is still an active member', async () => {
    const { service, prisma } = setup(['user-1', 'user-2']);
    await service.run();
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps going with the next tenant when one fails', async () => {
    const { service, prisma, systemPrisma } = setup();
    systemPrisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1' },
      { id: 'tenant-2' },
    ]);
    prisma.pushDevice.updateMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ count: 0 });

    await expect(service.run()).resolves.not.toThrow();
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledTimes(1);
  });
});
