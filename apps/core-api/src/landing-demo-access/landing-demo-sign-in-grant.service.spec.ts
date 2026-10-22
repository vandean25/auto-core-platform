import { describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import {
  LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE,
  LANDING_DEMO_SIGN_IN_GRANT_INVALID_MESSAGE,
} from './landing-demo-sign-in-grant.errors.js';
import { TenantMemberRole } from '@prisma/client';
import { LandingDemoSignInGrantService } from './landing-demo-sign-in-grant.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

describe('LandingDemoSignInGrantService', () => {
  it('consumes a valid grant on first demo sign-in', async () => {
    const findFirst = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        id: 'grant-1',
        consumed_at: null,
        expires_at: new Date(Date.now() + 60_000),
      });
    const updateMany = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ count: 1 });

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
    const findFirst = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
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
    const findFirst = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(null);

    const systemPrisma = {
      landingDemoSignInGrant: {
        findFirst,
        updateMany: jest.fn(),
      },
      tenantMember: { count: jest.fn() },
    } as unknown as SystemPrismaService;

    const service = new LandingDemoSignInGrantService(systemPrisma);
    try {
      await service.assertDemoSignInGrantForSession('user-1');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as HttpException).getResponse()).toEqual({
        code: LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE,
        message: LANDING_DEMO_SIGN_IN_GRANT_INVALID_MESSAGE,
      });
    }
  });

  it('detects non-demo active memberships', async () => {
    const count = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(2);
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
