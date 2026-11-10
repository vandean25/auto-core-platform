import {
  DisplayLanguage,
  EmployeeRole,
  PlatformAdminRole,
  TenantMemberRole,
} from '@prisma/client';
import {
  ensureActiveSiteMembershipWithMemberEpoch,
  upsertActiveTenantMemberWithMemberEpoch,
} from '../../auth/scope-epoch-access-writes.js';
import type { SeedPrismaClient, TenantFoundationContext } from './types.js';

export type DemoUserDefinition = {
  email: string;
  firebaseUid?: string | null;
  platformRole?: PlatformAdminRole;
  tenantRole: TenantMemberRole;
  linkedEmployee?: { name: string; role: EmployeeRole };
  locale?: DisplayLanguage;
};

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

export async function resolveOrCreateDemoUser(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  tenantId: string,
  def: DemoUserDefinition,
): Promise<{
  id: string;
  firebaseUid: string | null;
  active_site_id: string | null;
}> {
  const email = def.email.toLowerCase().trim();

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
    return prisma.user.create({
      data: {
        email,
        firebaseUid: def.firebaseUid ?? null,
        active_tenant_id: tenantId,
        active_site_id: foundation.mainSite.id,
        locale: def.locale ?? null,
      },
    });
  }

  return prisma.user.update({
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

export async function upsertDemoPlatformAdmin(
  prisma: SeedPrismaClient,
  userId: string,
  def: DemoUserDefinition,
): Promise<void> {
  if (!def.platformRole) {
    return;
  }

  await prisma.platformAdmin.upsert({
    where: { user_id: userId },
    update: {
      role: def.platformRole,
      is_active: true,
    },
    create: {
      user_id: userId,
      role: def.platformRole,
      is_active: true,
    },
  });
}

export async function seedDemoTenantMemberWithEpoch(
  prisma: SeedPrismaClient,
  tenantId: string,
  userId: string,
  role: TenantMemberRole,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await upsertActiveTenantMemberWithMemberEpoch(tx, {
      tenantId,
      userId,
      role,
    });
  });
}

export async function upsertDemoSiteMemberships(
  prisma: SeedPrismaClient,
  tenantId: string,
  userId: string,
  siteIds: string[],
): Promise<void> {
  for (const siteId of siteIds) {
    await ensureActiveSiteMembershipWithMemberEpoch(prisma, {
      tenantId,
      userId,
      siteId,
    });
  }
}

export async function linkDemoEmployee(
  prisma: SeedPrismaClient,
  tenantId: string,
  userId: string,
  def: DemoUserDefinition,
): Promise<void> {
  if (!def.linkedEmployee) {
    return;
  }

  const existingEmployee = await prisma.employee.findFirst({
    where: {
      tenant_id: tenantId,
      name: def.linkedEmployee.name,
    },
  });

  if (existingEmployee) {
    await prisma.employee.update({
      where: { id: existingEmployee.id },
      data: { user_id: userId, is_active: true },
    });
    return;
  }

  await prisma.employee.create({
    data: {
      tenant_id: tenantId,
      name: def.linkedEmployee.name,
      role: def.linkedEmployee.role,
      user_id: userId,
      is_active: true,
    },
  });
}

export async function syncDemoFirebaseClaims(
  tenantId: string,
  def: DemoUserDefinition,
  options?: SeedDemoUsersOptions,
): Promise<void> {
  if (!options?.firebaseAuth || !def.firebaseUid) {
    return;
  }

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
    console.warn(`Failed to sync custom claims for ${def.email}:`, claimsError);
  }
}
