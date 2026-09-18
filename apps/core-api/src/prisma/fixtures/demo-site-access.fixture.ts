import type { SeedPrismaClient, TenantFoundationContext } from './types.js';

const DEMO_QA_EMAILS = [
  'grok-bot@auto.core.at',
  'grok-bot-tech@auto.core.at',
  'testauto@auto.core.at',
] as const;

/**
 * Grants active SiteMembership on every demo site for tenant members so QA
 * users see the SiteSwitcher after `db:seed:tenant-member` (AUT-290).
 */
export async function seedDemoSiteAccess(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
): Promise<void> {
  const tenantId = foundation.defaultTenant.id;
  const siteIds = [foundation.wienSite.id, foundation.grzSite.id];

  console.log('Seeding demo site memberships for tenant members...');

  const tenantMembers = await prisma.tenantMember.findMany({
    where: {
      tenant_id: tenantId,
      is_active: true,
      tenant: { is_active: true },
    },
    select: {
      user_id: true,
      user: {
        select: {
          id: true,
          email: true,
          active_tenant_id: true,
          active_site_id: true,
        },
      },
    },
  });

  const qaUsers = await prisma.user.findMany({
    where: { email: { in: [...DEMO_QA_EMAILS] } },
    select: {
      id: true,
      email: true,
      active_tenant_id: true,
      active_site_id: true,
    },
  });

  const userIds = new Set<string>([
    ...tenantMembers.map((member) => member.user_id),
    ...qaUsers.map((user) => user.id),
  ]);

  for (const userId of userIds) {
    for (const siteId of siteIds) {
      const existing = await prisma.siteMembership.findFirst({
        where: { tenant_id: tenantId, user_id: userId, site_id: siteId },
        select: { id: true },
      });

      if (existing) {
        await prisma.siteMembership.update({
          where: { id: existing.id },
          data: { is_active: true },
        });
        continue;
      }

      const tenantMember = await prisma.tenantMember.findFirst({
        where: { tenant_id: tenantId, user_id: userId, is_active: true },
        select: { id: true },
      });

      if (!tenantMember) {
        continue;
      }

      await prisma.siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: userId,
          site_id: siteId,
          is_active: true,
        },
      });
    }

    const user =
      tenantMembers.find((member) => member.user_id === userId)?.user ??
      qaUsers.find((candidate) => candidate.id === userId);

    if (
      user &&
      user.active_tenant_id === tenantId &&
      user.active_site_id === null
    ) {
      await prisma.user.update({
        where: { id: userId },
        data: { active_site_id: foundation.wienSite.id },
      });
    }
  }
}
