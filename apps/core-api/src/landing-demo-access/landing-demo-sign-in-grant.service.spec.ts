import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { TenantMemberRole } from '@prisma/client';
import { LandingDemoSignInGrantService } from './landing-demo-sign-in-grant.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

describe('LandingDemoSignInGrantService', () => {
  it('consumes a valid grant on first demo sign-in', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'grant-1',
      consumed_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });

    const systemPrisma = {
      landingDemoSignInGrant: { findFirst, updateMany },
      tenantMember: { count: jest.fn() },
    } as unknown as SystemPrismaService;

    const service = new LandingDemoSignInGrantService(systemPrisma);
    await expect(
      service.assertDemoSignInGrantForSession('user-1'),
    ).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalled();
  });

  it('allows subsequent sessions after the grant was consumed', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'grant-1',
      consumed_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    });

    const systemPrisma = {
      landingDemoSignInGrant: {
        findFirst,
        updateMany: jest.fn(),
      },
      tenantMember: { count: jest.fn() },
    } as unknown as SystemPrismaService;

    const service = new LandingDemoSignInGrantService(systemPrisma);
    await expect(
      service.assertDemoSignInGrantForSession('user-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects sign-in when no valid grant exists', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);

    const systemPrisma = {
      landingDemoSignInGrant: {
        findFirst,
        updateMany: jest.fn(),
      },
      tenantMember: { count: jest.fn() },
    } as unknown as SystemPrismaService;

    const service = new LandingDemoSignInGrantService(systemPrisma);
    await expect(
      service.assertDemoSignInGrantForSession('user-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('detects non-demo active memberships', async () => {
    const count = jest.fn().mockResolvedValue(2);
    const systemPrisma = {
      tenantMember: { count },
      landingDemoSignInGrant: {},
    } as unknown as SystemPrismaService;

    const service = new LandingDemoSignInGrantService(systemPrisma);
    await expect(service.userHasNonDemoActiveMembership('user-1')).resolves.toBe(
      true,
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { not: TenantMemberRole.DEMO },
        }),
      }),
    );
  });
});
