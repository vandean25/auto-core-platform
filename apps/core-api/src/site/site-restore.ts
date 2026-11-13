import type { Prisma } from '@prisma/client';
import type { SystemPrismaClient } from '../prisma/system-prisma.types.js';

type SiteRestoreDb = Pick<SystemPrismaClient, 'siteMembership' | 'user'>;

/** `User.last_site_by_tenant` as `{ [tenantId]: siteId }`; anything that is not a string entry is dropped. */
function toSiteMap(
  lastSiteByTenant: Prisma.JsonValue | null | undefined,
): Record<string, string> {
  if (
    typeof lastSiteByTenant !== 'object' ||
    lastSiteByTenant === null ||
    Array.isArray(lastSiteByTenant)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(lastSiteByTenant).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** The map with `tenantId` pointing at `siteId`; entries of other tenants are kept. */
export function withLastSiteId(
  lastSiteByTenant: Prisma.JsonValue | null | undefined,
  tenantId: string,
  siteId: string,
): Record<string, string> {
  return { ...toSiteMap(lastSiteByTenant), [tenantId]: siteId };
}

/**
 * AUT-979: after the active tenant changed, pick the session site in the new tenant.
 *
 * Only sites the user can activate count (same rule as `GET /me/sites`: active site, active site membership,
 * active tenant membership), so the stored last site is a hint that is re-checked here. The last site wins;
 * else the only activatable site; else none, and the client asks. The write is conditional on the tenant still
 * being `tenantId`, so a concurrent tenant change never trips the composite FK `(active_tenant_id, active_site_id)`.
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

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { last_site_by_tenant: true },
  });
  const lastSiteId: string | undefined = toSiteMap(user?.last_site_by_tenant)[
    tenantId
  ];
  const lastUsed = lastSiteId
    ? await db.siteMembership.findFirst({
        where: { ...activatable, site_id: lastSiteId },
        select: { site_id: true },
      })
    : null;
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
