import {
  DisplayLanguage,
  EmployeeRole,
  PlatformAdminRole,
  TenantMemberRole,
} from '@prisma/client';
import type { SeedPrismaClient, TenantFoundationContext } from './types.js';

export type DemoUserDefinition = {
  email: string;
  firebaseUid?: string | null;
  platformRole?: PlatformAdminRole;
  tenantRole: TenantMemberRole;
  mechanicEmployeeName?: string;
  locale?: DisplayLanguage;
};

export const DEMO_USERS: DemoUserDefinition[] = [
  {
    email: 'testauto@auto.core.at',
    firebaseUid: 'e39adbd4-1c55-4044-a4b7-7fd492c2cdbe',
    platformRole: PlatformAdminRole.SUPER_ADMIN,
    tenantRole: TenantMemberRole.ADMIN,
  },
  {
    email: 'grok-bot@auto.core.at',
    firebaseUid: 'pBTLzBLmwhUthUETFmkQUkFNS9j2',
    tenantRole: TenantMemberRole.ADMIN,
  },
  {
    email: 'grok-bot-tech@auto.core.at',
    firebaseUid: 'Jt5Dd8PCV9Xrhd2GjU31CsGCQCL2',
    tenantRole: TenantMemberRole.TECH,
    mechanicEmployeeName: 'Grok Bot',
  },
  {
    email: 'tablet-mechanic@auto.core.at',
    firebaseUid: '2hUKXTB9LWNhp6pnTzI7i91Cbd92',
    tenantRole: TenantMemberRole.TECH,
  },
  {
    email: 'workshop-demo-en@auto.core.at',
    firebaseUid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    tenantRole: TenantMemberRole.ADMIN,
    locale: 'en',
  },
];

export type SeedDemoUsersOptions = {
  bootstrapAdminEmail?: string;
  bootstrapAdminUid?: string;
  firebaseAuth?: {
    setCustomUserClaims: (
      uid: string,
      claims: Record<string, unknown>,
    ) => Promise<void>;
  };
};

export async function seedDemoUsers(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  options?: SeedDemoUsersOptions,
): Promise<void> {
  const tenantId = foundation.defaultTenant.id;
  const siteIds = [foundation.mainSite.id, foundation.grzSite.id];

  const usersToSeed: DemoUserDefinition[] = [...DEMO_USERS];

  const bootstrapEmail = (
    options?.bootstrapAdminEmail ?? process.env.BOOTSTRAP_ADMIN_EMAIL
  )
    ?.trim()
    .toLowerCase();

  const bootstrapUid = (
    options?.bootstrapAdminUid ?? process.env.BOOTSTRAP_ADMIN_UID
  )?.trim();

  if (bootstrapEmail) {
    usersToSeed.unshift({
      email: bootstrapEmail,
      firebaseUid: bootstrapUid || null,
      platformRole: PlatformAdminRole.SUPER_ADMIN,
      tenantRole: TenantMemberRole.OWNER,
    });
  }

  console.log('Seeding demo and bootstrap admin users...');

  for (const def of usersToSeed) {
    const email = def.email.toLowerCase().trim();
    console.log(`  → ${email} (${def.tenantRole})`);

    // 1. Resolve or create user
    let user = def.firebaseUid
      ? await prisma.user.findUnique({
          where: { firebaseUid: def.firebaseUid },
        })
      : null;

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email },
      });
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          firebaseUid: def.firebaseUid ?? null,
          active_tenant_id: tenantId,
          active_site_id: foundation.mainSite.id,
          locale: def.locale ?? null,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          email,
          firebaseUid: def.firebaseUid ?? user.firebaseUid,
          active_tenant_id: tenantId,
          active_site_id: user.active_site_id ?? foundation.mainSite.id,
          locale: def.locale ?? user.locale,
        },
      });
    }

    // 2. Platform Admin (SUPER_ADMIN)
    if (def.platformRole) {
      await prisma.platformAdmin.upsert({
        where: { user_id: user.id },
        update: {
          role: def.platformRole,
          is_active: true,
        },
        create: {
          user_id: user.id,
          role: def.platformRole,
          is_active: true,
        },
      });
    }

    // 3. Tenant Member
    await prisma.tenantMember.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: tenantId,
          user_id: user.id,
        },
      },
      update: {
        role: def.tenantRole,
        is_active: true,
      },
      create: {
        tenant_id: tenantId,
        user_id: user.id,
        role: def.tenantRole,
        is_active: true,
      },
    });

    /**
     * Intentional overlap with {@link seedDemoSiteAccess}: each user fixture
     * must be self-contained so the seed is correct even if run in isolation.
     * Both functions use upsert semantics so duplicate calls are idempotent.
     */
    // 4. Site Memberships
    for (const siteId of siteIds) {
      await prisma.siteMembership.upsert({
        where: {
          tenant_id_user_id_site_id: {
            tenant_id: tenantId,
            user_id: user.id,
            site_id: siteId,
          },
        },
        update: { is_active: true },
        create: {
          tenant_id: tenantId,
          user_id: user.id,
          site_id: siteId,
          is_active: true,
        },
      });
    }

    // 5. Mechanic Employee link if requested
    if (def.mechanicEmployeeName) {
      const existingEmployee = await prisma.employee.findFirst({
        where: {
          tenant_id: tenantId,
          name: def.mechanicEmployeeName,
        },
      });

      if (existingEmployee) {
        await prisma.employee.update({
          where: { id: existingEmployee.id },
          data: { user_id: user.id, is_active: true },
        });
      } else {
        await prisma.employee.create({
          data: {
            tenant_id: tenantId,
            name: def.mechanicEmployeeName,
            role: EmployeeRole.MECHANIC,
            user_id: user.id,
            is_active: true,
          },
        });
      }
    }

    // 6. Sync Firebase Claims if auth provider supplied and user has UID
    if (options?.firebaseAuth && def.firebaseUid) {
      try {
        const claims: Record<string, unknown> = {
          tenantId,
          role: def.tenantRole,
        };
        if (def.platformRole) {
          claims.platformRole = def.platformRole;
        }
        await options.firebaseAuth.setCustomUserClaims(def.firebaseUid, claims);
      } catch (claimsError) {
        console.warn(
          `Failed to sync custom claims for ${def.email}:`,
          claimsError,
        );
      }
    }
  }
}
