import type { SystemPrismaClient } from '../../prisma/system-prisma.types';

/**
 * The ONLY production writer of `User.active_tenant_id` (ruling 11/50).
 *
 * Every mutation of `active_tenant_id` must go through this helper so that the
 * composite FK `(active_tenant_id, active_site_id) → sites (tenant_id, id)` is
 * never violated: changing the active tenant atomically nulls the previous
 * tenant's `active_site_id`. It never auto-picks a site in the destination
 * tenant — recovery is `GET /me/sites` then `PATCH /me/active-site`.
 *
 * Call sites (must not be bypassed):
 *  - AuthSessionService.switchTenant
 *  - AuthSessionService.ensureActiveMembership
 *  - TenantMemberService invite/create auto-assign
 *  - TenantMemberService.syncUserClaims
 */
export async function setActiveTenant(
  user: SystemPrismaClient['user'],
  userId: string,
  tenantId: string | null,
): Promise<void> {
  await user.update({
    where: { id: userId },
    data: { active_tenant_id: tenantId, active_site_id: null },
  });
}
