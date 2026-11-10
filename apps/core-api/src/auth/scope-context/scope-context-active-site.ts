import type { Prisma } from '@prisma/client';

type ScopeContextSiteReader = {
  user: {
    findFirst: (args: Prisma.UserFindFirstArgs) => Promise<{
      active_tenant_id: string | null;
      active_site_id: string | null;
    } | null>;
  };
};

/**
 * Same validation rules as {@link SiteContextService.findSiteId}, but for an
 * explicit tenant instead of the HTTP session.
 */
export async function findValidatedActiveSiteIdForTenant(
  db: ScopeContextSiteReader,
  firebaseUid: string,
  tenantId: string,
): Promise<string | null> {
  const session = await db.user.findFirst({
    where: { firebaseUid },
    select: { active_tenant_id: true, active_site_id: true },
  });
  if (!session?.active_site_id || session.active_tenant_id !== tenantId) {
    return null;
  }

  const activeSiteId = session.active_site_id;
  const validated = await db.user.findFirst({
    where: {
      firebaseUid,
      active_tenant_id: tenantId,
      active_site_id: activeSiteId,
      memberships: {
        some: {
          tenant_id: tenantId,
          is_active: true,
        },
      },
      siteMemberships: {
        some: {
          tenant_id: tenantId,
          site_id: activeSiteId,
          is_active: true,
          site: { is_active: true },
        },
      },
    },
    select: { active_site_id: true },
  });

  return validated?.active_site_id ?? null;
}
