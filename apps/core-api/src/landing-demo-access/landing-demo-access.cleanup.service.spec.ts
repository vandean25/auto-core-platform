import { describe, expect, it, jest } from '@jest/globals';
import { TenantMemberRole } from '@prisma/client';
import { LandingDemoAccessCleanupService } from './landing-demo-access.cleanup.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

describe('LandingDemoAccessCleanupService', () => {
  it('checks remaining active memberships before disabling Firebase', async () => {
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
    expect(tenantMemberCount).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { user_id: 'u-1', is_active: true },
      }),
    );
    expect(tenantMemberCount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { user_id: 'u-2', is_active: true },
      }),
    );
  });
});
