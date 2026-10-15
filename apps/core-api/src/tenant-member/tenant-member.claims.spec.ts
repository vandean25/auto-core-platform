import { PlatformAdminRole, TenantMemberRole } from '@prisma/client';
import {
  buildTenantClaims,
  isActiveTenantOutOfSync,
  resolveActiveMembership,
} from './tenant-member.claims.js';

describe('resolveActiveMembership', () => {
  it('prefers the membership for the active tenant', () => {
    const memberships = [
      { tenant_id: 'tenant-a', role: TenantMemberRole.ADMIN },
      { tenant_id: 'tenant-b', role: TenantMemberRole.TECH },
    ];

    expect(
      resolveActiveMembership({ active_tenant_id: 'tenant-b', memberships }),
    ).toBe(memberships[1]);
  });

  it('falls back to the first membership when the active tenant has none', () => {
    const memberships = [
      { tenant_id: 'tenant-a', role: TenantMemberRole.ADMIN },
    ];

    expect(
      resolveActiveMembership({ active_tenant_id: 'tenant-z', memberships }),
    ).toBe(memberships[0]);
  });

  it('returns null when the user has no active memberships', () => {
    expect(
      resolveActiveMembership({ active_tenant_id: null, memberships: [] }),
    ).toBeNull();
  });
});

describe('isActiveTenantOutOfSync', () => {
  it('treats a missing active tenant and a missing membership as in sync', () => {
    expect(isActiveTenantOutOfSync(null, null)).toBe(false);
    expect(isActiveTenantOutOfSync(undefined, null)).toBe(false);
  });

  it('flags an active tenant that differs from the resolved membership', () => {
    expect(
      isActiveTenantOutOfSync('tenant-a', {
        tenant_id: 'tenant-b',
        role: TenantMemberRole.TECH,
      }),
    ).toBe(true);
    expect(isActiveTenantOutOfSync('tenant-a', null)).toBe(true);
  });

  it('accepts an active tenant that matches the resolved membership', () => {
    expect(
      isActiveTenantOutOfSync('tenant-a', {
        tenant_id: 'tenant-a',
        role: TenantMemberRole.TECH,
      }),
    ).toBe(false);
  });
});

describe('buildTenantClaims', () => {
  const adminMembership = {
    tenant_id: 'tenant-a',
    role: TenantMemberRole.ADMIN,
  };

  it('keeps unrelated claims and replaces tenant and role from the active membership', () => {
    expect(
      buildTenantClaims(
        {
          existing: 'claim',
          tenantId: 'tenant-old',
          role: TenantMemberRole.TECH,
        },
        adminMembership,
        null,
      ),
    ).toStrictEqual({
      existing: 'claim',
      tenantId: 'tenant-a',
      role: TenantMemberRole.ADMIN,
    });
  });

  it('drops stale tenant, role and platform claims when nothing is active', () => {
    expect(
      buildTenantClaims(
        {
          existing: 'claim',
          tenantId: 'tenant-old',
          role: TenantMemberRole.TECH,
          platformRole: PlatformAdminRole.SUPER_ADMIN,
        },
        null,
        null,
      ),
    ).toStrictEqual({ existing: 'claim' });
  });

  it('projects the platform role only for an active platform admin', () => {
    expect(
      buildTenantClaims(undefined, adminMembership, {
        role: PlatformAdminRole.SUPER_ADMIN,
        is_active: true,
      }),
    ).toStrictEqual({
      tenantId: 'tenant-a',
      role: TenantMemberRole.ADMIN,
      platformRole: PlatformAdminRole.SUPER_ADMIN,
    });
    expect(
      buildTenantClaims(
        { platformRole: PlatformAdminRole.SUPER_ADMIN },
        adminMembership,
        { role: PlatformAdminRole.SUPER_ADMIN, is_active: false },
      ),
    ).toStrictEqual({
      tenantId: 'tenant-a',
      role: TenantMemberRole.ADMIN,
    });
  });
});
