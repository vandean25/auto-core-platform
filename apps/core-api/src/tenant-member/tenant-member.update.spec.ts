import { TenantMemberRole } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  buildMembershipUpdateData,
  isSecuritySensitiveChange,
} from './tenant-member.update.js';
import { TenantMemberService } from './tenant-member.service.js';

describe('buildMembershipUpdateData', () => {
  it('maps only the role when only the role is provided', () => {
    expect(
      buildMembershipUpdateData({ role: TenantMemberRole.TECH }),
    ).toStrictEqual({ role: TenantMemberRole.TECH });
  });

  it('maps only the active flag when only isActive is provided', () => {
    expect(buildMembershipUpdateData({ isActive: false })).toStrictEqual({
      is_active: false,
    });
  });

  it('returns an empty update when nothing is provided', () => {
    expect(buildMembershipUpdateData({})).toStrictEqual({});
  });
});

describe('isSecuritySensitiveChange', () => {
  it('flags a role that differs from the current role', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.ADMIN, {
        role: TenantMemberRole.TECH,
      }),
    ).toBe(true);
  });

  it('ignores a role that is unchanged', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.TECH, {
        role: TenantMemberRole.TECH,
      }),
    ).toBe(false);
  });

  it('flags deactivation regardless of the role', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.TECH, { isActive: false }),
    ).toBe(true);
  });

  it('does not flag reactivation or an empty update', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.TECH, { isActive: true }),
    ).toBe(false);
    expect(isSecuritySensitiveChange(TenantMemberRole.TECH, {})).toBe(false);
  });
});

describe('membership role change when the audit insert fails', () => {
  it('rolls the role change back when the audit delegate rejects', async () => {
    const membership = {
      id: 'membership-1',
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      role: TenantMemberRole.ADMIN,
      is_active: true,
      createdAt: new Date('2026-04-23T10:00:00.000Z'),
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      user: {
        id: 'user-1',
        email: 'tech@autocore.com',
        firstName: 'Tech',
        lastName: 'User',
        firebaseUid: 'firebase-uid-1',
        active_tenant_id: 'tenant-a',
      },
    };
    let committedRole: TenantMemberRole = TenantMemberRole.ADMIN;
    const auditCreate = jest
      .fn()
      .mockRejectedValue(new Error('audit insert failed'));
    const update = jest.fn(
      async (args: { data: { role?: TenantMemberRole } }) => ({
        ...membership,
        ...args.data,
      }),
    );
    const committedMembership = {
      ...membership,
      role: TenantMemberRole.TECH,
      scope_epoch: 1n,
      updatedAt: new Date('2026-04-23T11:00:00.000Z'),
    };
    const systemPrisma = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue(membership),
        findFirstOrThrow: jest.fn().mockResolvedValue(committedMembership),
        update,
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
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
        }),
      },
      auditLog: { create: auditCreate },
      $transaction: jest.fn(
        async (fn: (client: typeof systemPrisma) => Promise<{ role: TenantMemberRole }>) => {
          const result = await fn(systemPrisma);
          committedRole = result.role;
          return result;
        },
      ),
    };
    const tenantContext = {
      getRequiredTenantId: jest.fn().mockReturnValue('tenant-a'),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'admin-user',
        email: 'admin@autocore.com',
        tenantId: 'tenant-a',
        role: 'ADMIN',
      }),
    };
    const realtime = {
      emitClaimsUpdated: jest.fn(),
      emitSiteContextUpdated: jest.fn(),
      emitSiteAccessScopeUpdated: jest.fn(),
    };

    class TestableTenantMemberService extends TenantMemberService {
      public override getFirebaseAuth() {
        return {
          getUser: jest.fn().mockResolvedValue({ customClaims: {} }),
          setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
          revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
        } as never;
      }
    }

    const service = new TestableTenantMemberService(
      systemPrisma as unknown as SystemPrismaService,
      tenantContext as unknown as TenantContextService,
      realtime as unknown as DashboardRealtimeService,
      { $transaction: jest.fn() } as unknown as PrismaService,
    );

    let thrown: unknown;
    try {
      await service.update('membership-1', { role: TenantMemberRole.TECH });
    } catch (error) {
      thrown = error;
    }

    expect(committedRole).toBe(TenantMemberRole.ADMIN);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('audit insert failed');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: expect.objectContaining({
          role: TenantMemberRole.TECH,
          scope_epoch: '1',
          updatedAt: '2026-04-23T11:00:00.000Z',
        }),
      }),
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'membership-1', tenant_id: 'tenant-a' },
        data: { role: TenantMemberRole.TECH },
      }),
    );
  });
});
