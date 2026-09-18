import { PlatformAdminRole, TenantMemberRole } from '@prisma/client';
import {
  grantTenantSiteMemberships,
  parseSeedTenantMemberArgs,
  pickPreferredActiveSite,
  seedTenantMember,
} from './seed-tenant-member.js';

describe('parseSeedTenantMemberArgs', () => {
  it('fails when --email is missing', () => {
    expect(() =>
      parseSeedTenantMemberArgs(['--tenant-slug=uitz']),
    ).toThrow('Missing required --email=<email> argument.');
  });

  it('fails when --tenant-slug is missing', () => {
    expect(() =>
      parseSeedTenantMemberArgs(['--email=testauto@auto.core.at']),
    ).toThrow('Missing required --tenant-slug=<slug> argument.');
  });

  it('normalizes and parses all options', () => {
    expect(
      parseSeedTenantMemberArgs([
        '--email=TestAuto@Auto.Core.At',
        '--tenant-slug=UITZ',
        '--role=owner',
        '--make-active',
      ]),
    ).toEqual({
      email: 'testauto@auto.core.at',
      tenantSlug: 'uitz',
      role: 'OWNER',
      makeActive: true,
    });
  });

  it('defaults role to ADMIN', () => {
    expect(
      parseSeedTenantMemberArgs([
        '--email=testauto@auto.core.at',
        '--tenant-slug=uitz',
      ]),
    ).toEqual({
      email: 'testauto@auto.core.at',
      tenantSlug: 'uitz',
      role: 'ADMIN',
      makeActive: false,
    });
  });
});

describe('pickPreferredActiveSite', () => {
  it('prefers MAIN over GRZ when setting the default active site', () => {
    const sites = [
      { id: 'site-grz', code: 'GRZ' },
      { id: 'site-main', code: 'MAIN' },
    ];

    expect(pickPreferredActiveSite(sites)?.id).toBe('site-main');
  });
});

describe('grantTenantSiteMemberships', () => {
  it('sets active_site_id to MAIN when the user has no active site', async () => {
    const prisma = {
      site: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'site-grz', code: 'GRZ' },
          { id: 'site-main', code: 'MAIN' },
        ]),
      },
      siteMembership: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sm-1' }),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          active_tenant_id: 'tenant-1',
          active_site_id: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    await grantTenantSiteMemberships('tenant-1', 'user-1', prisma as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { active_site_id: 'site-main' },
    });
  });
});

describe('seedTenantMember', () => {
  it('creates membership and syncs claims for an existing user', async () => {
    const prisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          slug: 'uitz',
          is_active: true,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          active_tenant_id: 'tenant-legacy',
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: 'user-1',
          active_tenant_id: 'tenant-legacy',
        }),
      },
      tenantMember: {
        upsert: jest.fn().mockResolvedValue({
          id: 'membership-1',
          tenant_id: 'tenant-1',
          user_id: 'user-1',
          role: TenantMemberRole.OWNER,
          is_active: true,
        }),
      },
      userAccessProjection: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'user-1',
          firebaseUid: 'firebase-uid-1',
          email: 'testauto@auto.core.at',
          active_tenant_id: 'tenant-legacy',
          platformAdmin: {
            role: PlatformAdminRole.SUPER_ADMIN,
            is_active: true,
          },
          memberships: [
            {
              tenant_id: 'tenant-1',
              role: TenantMemberRole.OWNER,
              is_active: true,
              tenant: { is_active: true },
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          firebaseUid: 'firebase-uid-1',
          email: 'testauto@auto.core.at',
          active_tenant_id: 'tenant-1',
          platformAdmin: {
            role: PlatformAdminRole.SUPER_ADMIN,
            is_active: true,
          },
          memberships: [
            {
              tenant_id: 'tenant-1',
              role: TenantMemberRole.OWNER,
              is_active: true,
              tenant: { is_active: true },
            },
          ],
        }),
    };
    const firebaseAuth = {
      getUserByEmail: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'testauto@auto.core.at',
      }),
      createUser: jest.fn(),
      getUser: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-1',
        customClaims: { supportTier: 'gold' },
      }),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };

    const result = await seedTenantMember(
      {
        email: 'testauto@auto.core.at',
        tenantSlug: 'uitz',
        role: TenantMemberRole.OWNER,
        makeActive: false,
      },
      { prisma, firebaseAuth },
    );

    expect(prisma.tenantMember.upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_user_id: {
          tenant_id: 'tenant-1',
          user_id: 'user-1',
        },
      },
      update: { role: TenantMemberRole.OWNER, is_active: true },
      create: {
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        role: TenantMemberRole.OWNER,
        is_active: true,
      },
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { active_tenant_id: 'tenant-1' },
    });

    expect(firebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      {
        supportTier: 'gold',
        tenantId: 'tenant-1',
        role: TenantMemberRole.OWNER,
        platformRole: PlatformAdminRole.SUPER_ADMIN,
      },
    );

    expect(result).toEqual({
      email: 'testauto@auto.core.at',
      tenantSlug: 'uitz',
      tenantId: 'tenant-1',
      userId: 'user-1',
      firebaseUid: 'firebase-uid-1',
      membershipId: 'membership-1',
      role: TenantMemberRole.OWNER,
      activeTenantId: 'tenant-1',
    });
  });
});
