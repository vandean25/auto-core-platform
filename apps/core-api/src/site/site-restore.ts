import type { Prisma } from '@prisma/client';
import type { SystemPrismaClient } from '../prisma/system-prisma.types.js';

type SiteRestoreDb = Pick<SystemPrismaClient, 'siteMembership' | 'user'>;

/**
 * AUT-979: after the active tenant changed, pick the session site in the new tenant.
 *
 * Only sites the user can activate count (same rule as `GET /me/sites`: active site, active site membership,
 * active tenant membership). The latest site the user made active wins; else the only activatable site; else
 * none, and the client asks. The write is conditional on the tenant still being `tenantId`, so a concurrent
 * tenant change never trips the composite FK `(active_tenant_id, active_site_id)`.
 */
export async function restoreActiveSiteForTenant(
  db: SiteRestoreDb,
  userId: string,
  tenantId: string,
): Promise<string | null> {
  const activatable = {
    tenant_id: tenantId,
    user_id: userId,
    is_active: true,
    site: { is_active: true },
    tenantMember: { is_active: true },
  } satisfies Prisma.SiteMembershipWhereInput;

  const lastUsed = await db.siteMembership.findFirst({
    where: { ...activatable, last_active_at: { not: null } },
    orderBy: { last_active_at: 'desc' },
    select: { site_id: true },
  });
  const siteId = lastUsed?.site_id ?? (await findOnlySiteId(db, activatable));
  if (!siteId) {
    return null;
  }

  const { count } = await db.user.updateMany({
    where: { id: userId, active_tenant_id: tenantId },
    data: { active_site_id: siteId },
  });
  return count === 1 ? siteId : null;
}

async function findOnlySiteId(
  db: SiteRestoreDb,
  where: Prisma.SiteMembershipWhereInput,
): Promise<string | null> {
  const memberships = await db.siteMembership.findMany({
    where,
    select: { site_id: true },
    take: 2,
  });
  return memberships.length === 1 ? memberships[0].site_id : null;
}
