import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { TenantMemberRole } from '@prisma/client';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';

const updateUser =
  jest.fn<(uid: string, properties: { disabled: boolean }) => Promise<void>>();
const getFirebaseAdminAuth = jest.fn(() => ({ updateUser }));

jest.unstable_mockModule('../auth/firebase-admin.js', () => ({
  getFirebaseAdminAuth: () => getFirebaseAdminAuth(),
}));

const { LandingDemoAccessCleanupService } = await import(
  './landing-demo-access.cleanup.service.js'
);

describe('LandingDemoAccessCleanupService', () => {
  beforeEach(() => {
    updateUser.mockReset();
    updateUser.mockResolvedValue(undefined);
    getFirebaseAdminAuth.mockClear();
  });

  it('disables Firebase only when no other active memberships remain', async () => {
    const tenantMemberUpdate = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({});
    const tenantMemberCount = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const deleteMany = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ count: 0 });
    const findMany = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue([
        {
          id: 'm-1',
          tenant_id: 'tenant-1',
          user: { id: 'u-1', firebaseUid: 'fb-1' },
        },
        {
          id: 'm-2',
          tenant_id: 'tenant-1',
          user: { id: 'u-2', firebaseUid: 'fb-2' },
        },
      ]);
    const $transaction = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenantMember: { update: tenantMemberUpdate },
          tenant: { updateMany: jest.fn() },
        }),
      );

    const systemPrisma = {
      tenantMember: {
        findMany,
        update: tenantMemberUpdate,
        count: tenantMemberCount,
      },
      publicRateLimitCounter: { deleteMany },
      $transaction,
      ...cronJobLockTestStub(),
    } as unknown as SystemPrismaService;

    const userAccessStatus = {
      advanceAllMembershipEpochs: jest.fn(() => Promise.resolve()),
    };

    const service = new LandingDemoAccessCleanupService(
      systemPrisma,
      userAccessStatus as never,
    );
    await service.deactivateExpiredDemoMemberships();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: TenantMemberRole.DEMO }),
      }),
    );
    expect($transaction).toHaveBeenCalledTimes(2);
    expect(tenantMemberUpdate).toHaveBeenCalledTimes(2);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith('fb-2', { disabled: true });
  });
});
