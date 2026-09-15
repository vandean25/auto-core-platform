import { describe, expect, it, jest } from '@jest/globals';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { AuthSessionService } from './auth-session.service.js';

const ACTIVE_TENANT_ID = 'tenant-1';
const ACTIVE_SITE_ID = 'site-1';

describe('AuthSessionService active-site session projection', () => {
  it('projects User.active_site_id into the authenticated tenant user', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'firebase-user-1',
      email: 'user@example.com',
      active_tenant_id: ACTIVE_TENANT_ID,
      active_site_id: ACTIVE_SITE_ID,
      platformAdmin: null,
      memberships: [
        {
          tenant_id: ACTIVE_TENANT_ID,
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: ACTIVE_TENANT_ID,
            name: 'Tenant One',
            slug: 'tenant-one',
            is_active: true,
          },
        },
      ],
    });
    const systemPrisma = {
      user: { findFirst },
    } as unknown as SystemPrismaService;

    const service = new AuthSessionService(systemPrisma);
    const authenticatedUser = await service.resolveTenantUser({
      sub: 'firebase-user-1',
      email: 'user@example.com',
    });

    expect(authenticatedUser).toEqual(
      expect.objectContaining({
        tenantId: ACTIVE_TENANT_ID,
        activeSiteId: ACTIVE_SITE_ID,
      }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ active_site_id: true }),
      }),
    );
  });
});

describe('AuthSessionService identity resolution and email verification', () => {
  const sampleUserRecord = {
    id: 'user-1',
    firebaseUid: 'legit-uid',
    email: 'user@example.com',
    active_tenant_id: ACTIVE_TENANT_ID,
    active_site_id: null,
    platformAdmin: null,
    memberships: [
      {
        tenant_id: ACTIVE_TENANT_ID,
        role: 'ADMIN' as const,
        is_active: true,
        tenant: {
          id: ACTIVE_TENANT_ID,
          name: 'Tenant One',
          slug: 'tenant-one',
          is_active: true,
        },
      },
    ],
  };

  it('resolves by firebaseUid first and does not fall back to email if UID matches', async () => {
    const findFirst = jest.fn().mockResolvedValue(sampleUserRecord);
    const systemPrisma = {
      user: { findFirst },
    } as unknown as SystemPrismaService;

    const service = new AuthSessionService(systemPrisma);
    const result = await service.resolveTenantUser({
      sub: 'legit-uid',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(result).not.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { firebaseUid: 'legit-uid' },
      }),
    );
  });

  it('rejects identity resolution when UID is unknown and email is unverified', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const systemPrisma = {
      user: { findFirst },
    } as unknown as SystemPrismaService;

    const service = new AuthSessionService(systemPrisma);
    const result = await service.resolveTenantUser({
      sub: 'attacker-uid',
      email: 'user@example.com',
      emailVerified: false,
    });

    expect(result).toBeNull();
    // Must only have checked by UID, never by email when unverified
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { firebaseUid: 'attacker-uid' },
      }),
    );
  });

  it('rejects identity resolution when email is verified but user row already has another UID', async () => {
    const findFirst = jest.fn()
      .mockResolvedValueOnce(null) // by UID
      .mockResolvedValueOnce(null); // by email with firebaseUid: null

    const systemPrisma = {
      user: { findFirst },
    } as unknown as SystemPrismaService;

    const service = new AuthSessionService(systemPrisma);
    const result = await service.resolveTenantUser({
      sub: 'attacker-uid',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(result).toBeNull();
    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { firebaseUid: 'attacker-uid' },
      }),
    );
    expect(findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { email: 'user@example.com', firebaseUid: null },
      }),
    );
  });

  it('links user and succeeds when email is verified and user row has firebaseUid: null', async () => {
    const unboundUser = {
      ...sampleUserRecord,
      id: 'unbound-user-1',
      firebaseUid: null,
    };
    const findFirst = jest.fn()
      .mockResolvedValueOnce(null) // by UID
      .mockResolvedValueOnce(unboundUser); // by email with firebaseUid: null
    const update = jest.fn().mockResolvedValue({
      ...unboundUser,
      firebaseUid: 'new-uid',
    });

    const systemPrisma = {
      user: { findFirst, update },
    } as unknown as SystemPrismaService;

    const service = new AuthSessionService(systemPrisma);
    const result = await service.resolveTenantUser({
      sub: 'new-uid',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(result).not.toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'unbound-user-1' },
      data: { firebaseUid: 'new-uid' },
    });
  });
});
