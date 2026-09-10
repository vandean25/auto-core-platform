import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAdminUser } from './site.constants';

export function assertTenantAdmin(tenantContext: TenantContextService): void {
  const user = tenantContext.getAuthenticatedUser() as
    TenantAdminUser | undefined;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
    throw new ForbiddenException('Tenant admin access is required.');
  }
}

/** Resolves the authenticated user's relational User row in this tenant. */
export async function resolveCurrentUser(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<{ id: string } | null> {
  const authUser = tenantContext.getAuthenticatedUser() as
    TenantAdminUser | undefined;
  if (!authUser?.userId) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { firebaseUid: authUser.userId },
    select: { id: true },
  });
  if (!user) {
    return null;
  }
  const member = await prisma.tenantMember.findFirst({
    where: { tenant_id: tenantId, user_id: user.id, is_active: true },
    select: { id: true },
  });
  return member ? user : null;
}

export async function requireActiveCurrentUser(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<{ id: string }> {
  const currentUser = await resolveCurrentUser(prisma, tenantContext, tenantId);
  if (!currentUser) {
    throw new ForbiddenException('Active tenant membership is required.');
  }
  return currentUser;
}

export async function hasActiveSiteMembership(
  prisma: PrismaService,
  tenantId: string,
  userId: string,
  siteId?: string,
): Promise<boolean> {
  const siteGrant = await prisma.siteMembership.findFirst({
    where: {
      tenant_id: tenantId,
      user_id: userId,
      is_active: true,
      ...(siteId ? { site_id: siteId } : {}),
    },
    select: { id: true },
  });
  return Boolean(siteGrant);
}

export async function assertActiveMemberWithSiteAccess(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<void> {
  const currentUser = await requireActiveCurrentUser(
    prisma,
    tenantContext,
    tenantId,
  );
  const hasAccess = await hasActiveSiteMembership(
    prisma,
    tenantId,
    currentUser.id,
  );
  if (!hasAccess) {
    throw new ForbiddenException(
      'At least one active site membership is required.',
    );
  }
}

export async function assertSiteReadAccess(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
  siteId: string,
): Promise<void> {
  const user = tenantContext.getAuthenticatedUser() as
    TenantAdminUser | undefined;
  if (user && (user.role === 'OWNER' || user.role === 'ADMIN')) {
    return;
  }
  const currentUser = await requireActiveCurrentUser(
    prisma,
    tenantContext,
    tenantId,
  );
  const hasAccess = await hasActiveSiteMembership(
    prisma,
    tenantId,
    currentUser.id,
    siteId,
  );
  if (!hasAccess) {
    throw new ForbiddenException(
      'An active site membership on this site is required.',
    );
  }
}

export async function assertSiteInTenant(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
): Promise<void> {
  const site = await prisma.site.findFirst({
    where: { tenant_id: tenantId, id: siteId },
    select: { id: true },
  });
  if (!site) {
    throw new NotFoundException('Site not found in this tenant');
  }
}
