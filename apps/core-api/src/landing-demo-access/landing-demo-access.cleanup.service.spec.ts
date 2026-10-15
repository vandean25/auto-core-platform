import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { TenantMemberRole } from '@prisma/client';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

const updateUser = jest.fn<() => Promise<void>>();
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
    const tenantMemberUpdate = jest.fn().mockResolvedValue({});
    const tenantMemberCount = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'm-1',
        user: { id: 'u-1', firebaseUid: 'fb-1' },
      },
      {
        id: 'm-2',
        user: { id: 'u-2', firebaseUid: 'fb-2' },
      },
    ]);

    const systemPrisma = {
      tenantMember: {
        findMany,
        update: tenantMemberUpdate,
        count: tenantMemberCount,
      },
      publicRateLimitCounter: { deleteMany },
    } as unknown as SystemPrismaService;

    const service = new LandingDemoAccessCleanupService(systemPrisma);
    await service.deactivateExpiredDemoMemberships();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: TenantMemberRole.DEMO }),
      }),
    );
    expect(tenantMemberUpdate).toHaveBeenCalledTimes(2);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith('fb-2', { disabled: true });
  });
});
