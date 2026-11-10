import {
  EmployeeRole,
  PlatformAdminRole,
  TenantMemberRole,
} from '@prisma/client';
import type { SeedPrismaClient, TenantFoundationContext } from './types.js';
import {
  linkDemoEmployee,
  resolveOrCreateDemoUser,
  seedDemoTenantMemberWithEpoch,
  syncDemoFirebaseClaims,
  upsertDemoPlatformAdmin,
  upsertDemoSiteMemberships,
  type DemoUserDefinition,
  type SeedDemoUsersOptions,
} from './demo-user-seed.steps.js';

export type { DemoUserDefinition, SeedDemoUsersOptions };

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
    linkedEmployee: {
      name: 'Grok Bot QA',
      role: EmployeeRole.SERVICE_ADVISOR,
    },
  },
  {
    email: 'grok-bot-tech@auto.core.at',
    firebaseUid: 'Jt5Dd8PCV9Xrhd2GjU31CsGCQCL2',
    tenantRole: TenantMemberRole.TECH,
    linkedEmployee: { name: 'Grok Bot', role: EmployeeRole.MECHANIC },
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

    const user = await resolveOrCreateDemoUser(
      prisma,
      foundation,
      tenantId,
      def,
    );
    await upsertDemoPlatformAdmin(prisma, user.id, def);
    await seedDemoTenantMemberWithEpoch(
      prisma,
      tenantId,
      user.id,
      def.tenantRole,
    );
    await upsertDemoSiteMemberships(prisma, tenantId, user.id, siteIds);
    await linkDemoEmployee(prisma, tenantId, user.id, def);
    await syncDemoFirebaseClaims(tenantId, def, options);
  }
}
