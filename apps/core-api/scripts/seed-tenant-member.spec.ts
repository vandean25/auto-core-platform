import { PlatformAdminRole } from '@prisma/client';
import { EmployeeRole, TenantMemberRole } from '@prisma/client';
import {
  grantTechnicianEmployeeLink,
  grantTenantSiteMemberships,
  parseSeedTenantMemberArgs,
  pickPreferredActiveSite,
  resolveTechnicianEmployeeName,
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

describe('resolveTechnicianEmployeeName', () => {
  it('maps grok-bot-tech to Grok Bot', () => {
    expect(resolveTechnicianEmployeeName('grok-bot-tech@auto.core.at')).toBe(
      'Grok Bot',
    );
  });

  it('title-cases unknown technician emails', () => {
    expect(resolveTechnicianEmployeeName('qa.tech@auto.core.at')).toBe('Qa Tech');
  });
});

describe('grantTechnicianEmployeeLink', () => {
  it('links an existing unlinked Grok Bot mechanic employee', async () => {
    const prisma = {
      employee: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'employee-grok' }),
        update: jest.fn().mockResolvedValue({ id: 'employee-grok' }),
        create: jest.fn(),
      },
      employeeWorkSchedule: { create: jest.fn() },
      employeeWorkScheduleDay: {},
    };

    const result = await grantTechnicianEmployeeLink(
      'tenant-1',
      'user-tech',
      'grok-bot-tech@auto.core.at',
      prisma as never,
    );

    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'employee-grok' },
      data: { user_id: 'user-tech' },
    });
    expect(result).toEqual({
      employeeId: 'employee-grok',
      created: false,
      linkedExisting: true,
    });
  });

  it('creates a mechanic employee with a default work schedule when none exists', async () => {
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'employee-new' }),
      },
      employeeWorkSchedule: {
        create: jest.fn().mockResolvedValue({ id: 'schedule-1' }),
      },
      employeeWorkScheduleDay: {},
    };

    const result = await grantTechnicianEmployeeLink(
      'tenant-1',
      'user-tech',
      'grok-bot-tech@auto.core.at',
      prisma as never,
    );

    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        user_id: 'user-tech',
        name: 'Grok Bot',
        role: EmployeeRole.MECHANIC,
        is_active: true,
      },
      select: { id: true },
    });
    expect(prisma.employeeWorkSchedule.create).toHaveBeenCalled();
    expect(result).toEqual({
      employeeId: 'employee-new',
      created: true,
      linkedExisting: false,
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
      mechanicEmployeeId: null,
    });
  });

  it('links a mechanic employee when seeding a TECH tenant member', async () => {
    const prisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          slug: 'default-workshop',
          is_active: true,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-tech',
          active_tenant_id: 'tenant-1',
        }),
        update: jest.fn(),
      },
      tenantMember: {
        upsert: jest.fn().mockResolvedValue({
          id: 'membership-tech',
          tenant_id: 'tenant-1',
          user_id: 'user-tech',
          role: TenantMemberRole.TECH,
          is_active: true,
        }),
      },
      userAccessProjection: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'user-tech',
          firebaseUid: 'firebase-tech',
          email: 'grok-bot-tech@auto.core.at',
          active_tenant_id: 'tenant-1',
          platformAdmin: null,
          memberships: [
            {
              tenant_id: 'tenant-1',
              role: TenantMemberRole.TECH,
              is_active: true,
              tenant: { is_active: true },
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'user-tech',
          firebaseUid: 'firebase-tech',
          email: 'grok-bot-tech@auto.core.at',
          active_tenant_id: 'tenant-1',
          platformAdmin: null,
          memberships: [
            {
              tenant_id: 'tenant-1',
              role: TenantMemberRole.TECH,
              is_active: true,
              tenant: { is_active: true },
            },
          ],
        }),
    };
    const firebaseAuth = {
      getUserByEmail: jest.fn().mockResolvedValue({
        uid: 'firebase-tech',
        email: 'grok-bot-tech@auto.core.at',
      }),
      createUser: jest.fn(),
      getUser: jest.fn().mockResolvedValue({
        uid: 'firebase-tech',
        customClaims: {},
      }),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };
    const grantTechnicianEmployeeLink = jest.fn().mockResolvedValue({
      employeeId: 'employee-grok',
      created: true,
      linkedExisting: false,
    });

    const result = await seedTenantMember(
      {
        email: 'grok-bot-tech@auto.core.at',
        tenantSlug: 'default-workshop',
        role: TenantMemberRole.TECH,
        makeActive: true,
      },
      { prisma, firebaseAuth, grantTechnicianEmployeeLink },
    );

    expect(grantTechnicianEmployeeLink).toHaveBeenCalledWith(
      'tenant-1',
      'user-tech',
      'grok-bot-tech@auto.core.at',
    );
    expect(result.mechanicEmployeeId).toBe('employee-grok');
  });
});
