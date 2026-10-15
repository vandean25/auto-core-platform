import type { PlatformAdmin, TenantMember } from '@prisma/client';

type ProjectedMembership = Pick<TenantMember, 'tenant_id' | 'role'>;
type ProjectedPlatformAdmin = Pick<PlatformAdmin, 'role' | 'is_active'>;

export function resolveActiveMembership<
  T extends Pick<TenantMember, 'tenant_id'>,
>(user: { active_tenant_id: string | null; memberships: T[] }): T | null {
  return (
    user.memberships.find(
      (membership) => membership.tenant_id === user.active_tenant_id,
    ) ??
    user.memberships[0] ??
    null
  );
}

export function isActiveTenantOutOfSync(
  activeTenantId: string | null | undefined,
  activeMembership: ProjectedMembership | null,
): boolean {
  return (activeTenantId ?? null) !== (activeMembership?.tenant_id ?? null);
}

export function buildTenantClaims(
  customClaims: Record<string, unknown> | undefined,
  activeMembership: ProjectedMembership | null,
  platformAdmin: ProjectedPlatformAdmin | null,
): Record<string, unknown> {
  const claims: Record<string, unknown> = { ...(customClaims ?? {}) };

  delete claims.tenantId;
  delete claims.role;
  delete claims.platformRole;

  if (activeMembership) {
    claims.tenantId = activeMembership.tenant_id;
    claims.role = activeMembership.role;
  }

  if (platformAdmin?.is_active) {
    claims.platformRole = platformAdmin.role;
  }

  return claims;
}
