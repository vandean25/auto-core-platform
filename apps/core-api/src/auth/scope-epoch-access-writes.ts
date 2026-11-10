import type { Prisma, PrismaClient, TenantMemberRole } from '@prisma/client';
import { advanceScopeEpoch } from './scope-epoch.js';

export type ScopeEpochMemberWriteTx = Pick<
  Prisma.TransactionClient,
  'tenantMember' | 'tenant' | 'siteMembership'
>;

type SiteMembershipPrisma = Pick<
  PrismaClient,
  'siteMembership' | 'tenantMember' | '$transaction'
>;

export async function upsertActiveTenantMemberWithMemberEpoch(
  tx: ScopeEpochMemberWriteTx,
  input: {
    tenantId: string;
    userId: string;
    role: TenantMemberRole;
  },
): Promise<{ id: string; role: TenantMemberRole }> {
  const row = await tx.tenantMember.upsert({
    where: {
      tenant_id_user_id: {
        tenant_id: input.tenantId,
        user_id: input.userId,
      },
    },
    update: {
      role: input.role,
      is_active: true,
    },
    create: {
      tenant_id: input.tenantId,
      user_id: input.userId,
      role: input.role,
      is_active: true,
    },
    select: { id: true, role: true },
  });
  await advanceScopeEpoch(tx, {
    kind: 'member',
    tenantId: input.tenantId,
    userId: input.userId,
  });
  return row;
}

export async function reactivateSiteMembershipWithMemberEpoch(
  tx: ScopeEpochMemberWriteTx,
  input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  },
): Promise<void> {
  await tx.siteMembership.update({
    where: { id: input.membershipId },
    data: { is_active: true },
  });
  await advanceScopeEpoch(tx, {
    kind: 'member',
    tenantId: input.tenantId,
    userId: input.userId,
  });
}

export async function ensureActiveSiteMembershipWithMemberEpoch(
  prisma: SiteMembershipPrisma,
  input: {
    tenantId: string;
    userId: string;
    siteId: string;
    requireActiveTenantMember?: boolean;
  },
): Promise<void> {
  const existing = await prisma.siteMembership.findFirst({
    where: {
      tenant_id: input.tenantId,
      user_id: input.userId,
      site_id: input.siteId,
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await reactivateSiteMembershipWithMemberEpoch(tx, {
        membershipId: existing.id,
        tenantId: input.tenantId,
        userId: input.userId,
      });
    });
    return;
  }

  if (input.requireActiveTenantMember) {
    const tenantMember = await prisma.tenantMember.findFirst({
      where: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        is_active: true,
      },
      select: { id: true },
    });
    if (!tenantMember) {
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    await createActiveSiteMembershipWithMemberEpoch(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      siteId: input.siteId,
    });
  });
}

export async function createActiveSiteMembershipWithMemberEpoch(
  tx: ScopeEpochMemberWriteTx,
  input: {
    tenantId: string;
    userId: string;
    siteId: string;
  },
): Promise<void> {
  await tx.siteMembership.create({
    data: {
      tenant_id: input.tenantId,
      user_id: input.userId,
      site_id: input.siteId,
      is_active: true,
    },
  });
  await advanceScopeEpoch(tx, {
    kind: 'member',
    tenantId: input.tenantId,
    userId: input.userId,
  });
}
