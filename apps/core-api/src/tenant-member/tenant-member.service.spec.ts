import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantMemberRole } from '@prisma/client';
import type { Auth } from 'firebase-admin/auth';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { TenantMemberService } from './tenant-member.service.js';

const mockSystemPrisma = {
  tenantMember: {
    findMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockTenantContext = {
  getRequiredTenantId: jest.fn().mockReturnValue('tenant-a'),
  getAuthenticatedUser: jest.fn().mockReturnValue({
    userId: 'admin-user',
    email: 'admin@autocore.com',
    tenantId: 'tenant-a',
    role: 'ADMIN',
  }),
};

describe('TenantMemberService', () => {
  let service: TenantMemberService;
  let mockDashboardRealtime: {
    emitClaimsUpdated: jest.Mock;
    emitSiteContextUpdated: jest.Mock;
    emitSiteAccessScopeUpdated: jest.Mock;
  };
  let mockFirebaseAuth: {
    getUserByEmail: jest.Mock;
    createUser: jest.Mock;
    getUser: jest.Mock;
    setCustomUserClaims: jest.Mock;
    revokeRefreshTokens: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSystemPrisma.tenantMember.findMany.mockReset();
    mockSystemPrisma.tenantMember.count.mockReset();
    mockSystemPrisma.tenantMember.upsert.mockReset();
    mockSystemPrisma.tenantMember.findFirst.mockReset();
    mockSystemPrisma.tenantMember.update.mockReset();
    mockSystemPrisma.user.findFirst.mockReset();
    mockSystemPrisma.user.create.mockReset();
    mockSystemPrisma.user.update.mockReset();

    mockDashboardRealtime = {
      emitClaimsUpdated: jest.fn(),
      emitSiteContextUpdated: jest.fn(),
      emitSiteAccessScopeUpdated: jest.fn(),
    };

    service = new TenantMemberService(
      mockSystemPrisma as unknown as SystemPrismaService,
      mockTenantContext as unknown as TenantContextService,
      mockDashboardRealtime as unknown as DashboardRealtimeService,
    );

    mockFirebaseAuth = {
      getUserByEmail: jest.fn(),
      createUser: jest.fn(),
      getUser: jest.fn(),
      setCustomUserClaims: jest.fn(),
      revokeRefreshTokens: jest.fn(),
    };

    jest
      .spyOn(
        service,
        'getFirebaseAuth',
      )
      .mockReturnValue(mockFirebaseAuth);
  });

  it('lists tenant members with related user data in a paginated response', async () => {
    mockSystemPrisma.tenantMember.findMany.mockResolvedValue([
      {
        id: 'membership-1',
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        role: TenantMemberRole.ADMIN,
        is_active: true,
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        updatedAt: new Date('2026-04-23T11:00:00.000Z'),
        user: {
          id: 'user-1',
          email: 'admin@autocore.com',
          firstName: 'Auto',
          lastName: 'Admin',
        },
      },
    ]);
    mockSystemPrisma.tenantMember.count.mockResolvedValue(1);

    const result = await service.findAll({ page: 1, limit: 25 });

    expect(mockSystemPrisma.tenantMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-a', is_active: true },
        include: { user: true },
      }),
    );
    expect(result).toEqual({
      data: [
        {
          id: 'membership-1',
          tenantId: 'tenant-a',
          userId: 'user-1',
          email: 'admin@autocore.com',
          firstName: 'Auto',
          lastName: 'Admin',
          role: TenantMemberRole.ADMIN,
          isActive: true,
          createdAt: new Date('2026-04-23T10:00:00.000Z'),
          updatedAt: new Date('2026-04-23T11:00:00.000Z'),
        },
      ],
      meta: {
        total: 1,
        page: 1,
        limit: 25,
        totalPages: 1,
      },
    });
  });

  it('invites a tenant member, provisioning the Firebase user when it does not yet exist', async () => {
    mockFirebaseAuth.getUserByEmail.mockRejectedValue({
      code: 'auth/user-not-found',
    });
    mockFirebaseAuth.createUser.mockResolvedValue({
      uid: 'firebase-uid-1',
      email: 'tech@autocore.com',
    });
    mockSystemPrisma.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'user-1',
        firebaseUid: 'firebase-uid-1',
        email: 'tech@autocore.com',
        active_tenant_id: 'tenant-a',
        platformAdmin: null,
        memberships: [
          {
            tenant_id: 'tenant-a',
            role: TenantMemberRole.TECH,
            is_active: true,
          },
        ],
      });
    mockSystemPrisma.user.create.mockResolvedValue({
      id: 'user-1',
      active_tenant_id: null,
    });
    mockSystemPrisma.user.update.mockResolvedValue({
      id: 'user-1',
      active_tenant_id: 'tenant-a',
    });
    mockSystemPrisma.tenantMember.upsert.mockResolvedValue({
      id: 'membership-1',
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      role: TenantMemberRole.TECH,
      is_active: true,
      createdAt: new Date('2026-04-23T10:00:00.000Z'),
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      user: {
        id: 'user-1',
        email: 'tech@autocore.com',
        firstName: null,
        lastName: null,
      },
    });
    mockFirebaseAuth.getUser.mockResolvedValue({
      uid: 'firebase-uid-1',
      customClaims: { existing: 'claim' },
    });
    mockFirebaseAuth.setCustomUserClaims.mockResolvedValue(undefined);

    const result = await service.invite({
      email: 'tech@autocore.com',
      role: TenantMemberRole.TECH,
    });

    expect(mockFirebaseAuth.createUser).toHaveBeenCalledWith({
      email: 'tech@autocore.com',
    });
    expect(mockSystemPrisma.tenantMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_user_id: {
            tenant_id: 'tenant-a',
            user_id: 'user-1',
          },
        },
      }),
    );
    expect(mockFirebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      {
        existing: 'claim',
        tenantId: 'tenant-a',
        role: TenantMemberRole.TECH,
      },
    );
    expect(mockDashboardRealtime.emitClaimsUpdated).toHaveBeenCalledWith(
      'firebase-uid-1',
    );
    expect(result).toMatchObject({
      id: 'membership-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      email: 'tech@autocore.com',
      role: TenantMemberRole.TECH,
      isActive: true,
    });
  });

  it('throws UnprocessableEntityException when inviting an email with an unverified existing Firebase account', async () => {
    mockFirebaseAuth.getUserByEmail.mockResolvedValue({
      uid: 'attacker-uid',
      email: 'unverified@autocore.com',
      emailVerified: false,
    });

    await expect(
      service.invite({
        email: 'unverified@autocore.com',
        role: TenantMemberRole.TECH,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(mockFirebaseAuth.createUser).not.toHaveBeenCalled();
    expect(mockSystemPrisma.user.create).not.toHaveBeenCalled();
    expect(mockSystemPrisma.tenantMember.upsert).not.toHaveBeenCalled();
  });

  it('invites a tenant member when existing Firebase account has emailVerified: true', async () => {
    mockFirebaseAuth.getUserByEmail.mockResolvedValue({
      uid: 'verified-uid-2',
      email: 'verified@autocore.com',
      emailVerified: true,
    });
    mockSystemPrisma.user.findFirst
      .mockResolvedValueOnce(null) // by UID
      .mockResolvedValueOnce(null) // by email unbound
      .mockResolvedValueOnce(null) // by email conflict check
      .mockResolvedValueOnce({
        id: 'user-2',
        firebaseUid: 'verified-uid-2',
        email: 'verified@autocore.com',
        active_tenant_id: 'tenant-a',
        platformAdmin: null,
        memberships: [
          {
            tenant_id: 'tenant-a',
            role: TenantMemberRole.TECH,
            is_active: true,
          },
        ],
      });
    mockSystemPrisma.user.create.mockResolvedValue({
      id: 'user-2',
      active_tenant_id: null,
    });
    mockSystemPrisma.user.update.mockResolvedValue({
      id: 'user-2',
      active_tenant_id: 'tenant-a',
    });
    mockSystemPrisma.tenantMember.upsert.mockResolvedValue({
      id: 'membership-2',
      tenant_id: 'tenant-a',
      user_id: 'user-2',
      role: TenantMemberRole.TECH,
      is_active: true,
      createdAt: new Date('2026-04-23T10:00:00.000Z'),
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      user: {
        id: 'user-2',
        email: 'verified@autocore.com',
        firstName: null,
        lastName: null,
      },
    });
    mockFirebaseAuth.getUser.mockResolvedValue({
      uid: 'verified-uid-2',
      customClaims: {},
    });
    mockFirebaseAuth.setCustomUserClaims.mockResolvedValue(undefined);

    const result = await service.invite({
      email: 'verified@autocore.com',
      role: TenantMemberRole.TECH,
    });

    expect(result).toMatchObject({
      id: 'membership-2',
      tenantId: 'tenant-a',
      userId: 'user-2',
      email: 'verified@autocore.com',
      role: TenantMemberRole.TECH,
    });
  });

  it('throws ConflictException when inviting an email that belongs to another UID in the database', async () => {
    mockFirebaseAuth.getUserByEmail.mockResolvedValue({
      uid: 'attacker-uid-3',
      email: 'victim@autocore.com',
      emailVerified: true,
    });
    mockSystemPrisma.user.findFirst
      .mockResolvedValueOnce(null) // by UID attacker-uid-3
      .mockResolvedValueOnce(null) // by email unbound
      .mockResolvedValueOnce({
        id: 'victim-user-id',
        firebaseUid: 'victim-uid-original',
        email: 'victim@autocore.com',
      }); // by email conflict check

    await expect(
      service.invite({
        email: 'victim@autocore.com',
        role: TenantMemberRole.TECH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockSystemPrisma.user.create).not.toHaveBeenCalled();
    expect(mockSystemPrisma.tenantMember.upsert).not.toHaveBeenCalled();
  });

  it('updates a membership, revokes refresh tokens for security-sensitive changes, and emits claims refresh', async () => {
    mockSystemPrisma.tenantMember.findFirst.mockResolvedValue({
      id: 'membership-1',
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      role: TenantMemberRole.ADMIN,
      is_active: true,
      createdAt: new Date('2026-04-23T10:00:00.000Z'),
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      user: {
        id: 'user-1',
        email: 'admin@autocore.com',
        firstName: 'Auto',
        lastName: 'Admin',
      },
    });
    mockSystemPrisma.tenantMember.update.mockResolvedValue({
      id: 'membership-1',
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      role: TenantMemberRole.TECH,
      is_active: false,
      createdAt: new Date('2026-04-23T10:00:00.000Z'),
      updatedAt: new Date('2026-04-23T11:00:00.000Z'),
      user: {
        id: 'user-1',
        email: 'admin@autocore.com',
        firstName: 'Auto',
        lastName: 'Admin',
      },
    });
    mockSystemPrisma.user.findFirst
      .mockResolvedValueOnce({
        id: 'user-1',
        firebaseUid: 'firebase-uid-1',
        email: 'admin@autocore.com',
        active_tenant_id: null,
        platformAdmin: null,
        memberships: [],
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        firebaseUid: 'firebase-uid-1',
      });
    mockFirebaseAuth.getUser.mockResolvedValue({
      uid: 'firebase-uid-1',
      customClaims: {
        tenantId: 'tenant-a',
        role: TenantMemberRole.ADMIN,
      },
    });
    mockFirebaseAuth.setCustomUserClaims.mockResolvedValue(undefined);
    mockFirebaseAuth.revokeRefreshTokens.mockResolvedValue(undefined);

    const result = await service.update('membership-1', {
      role: TenantMemberRole.TECH,
      isActive: false,
    });

    expect(mockSystemPrisma.tenantMember.update).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      data: {
        role: TenantMemberRole.TECH,
        is_active: false,
      },
      include: { user: true },
    });
    expect(mockFirebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      {},
    );
    expect(mockFirebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith(
      'firebase-uid-1',
    );
    expect(mockDashboardRealtime.emitClaimsUpdated).toHaveBeenCalledWith(
      'firebase-uid-1',
    );
    expect(result).toMatchObject({
      id: 'membership-1',
      role: TenantMemberRole.TECH,
      isActive: false,
    });
  });

  it('rejects membership management for non-admin tenant users', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'tech-user',
      email: 'tech@autocore.com',
      tenantId: 'tenant-a',
      role: 'TECH',
    });

    await expect(
      service.invite({
        email: 'sales@autocore.com',
        role: TenantMemberRole.SALES,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
