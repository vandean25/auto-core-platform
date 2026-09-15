import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Asserts that the authenticated user holds an active TenantMember and
 * an active SiteMembership on the specified target site.
 *
 * Ruling 14 / ADR-0022 §3:
 * Every document site change requires an active SiteMembership on the target site
 * (workshop, sales, purchase order, vehicle purchase, vehicle sale).
 * Names-only directory IDs are not authorization. Non-members fail with 422.
 */
export async function assertActiveTargetSiteMembership(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantContext: TenantContextService,
  tenantId: string,
  targetSiteId: string,
): Promise<void> {
  const authUser = tenantContext.getAuthenticatedUser() as
    { userId?: string; role?: string } | undefined;

  if (!authUser?.userId) {
    throw new UnprocessableEntityException(
      'Active site membership required on target site',
    );
  }

  const user = await prisma.user.findUnique({
    where: { firebaseUid: authUser.userId },
    select: { id: true },
  });

  if (!user) {
    throw new UnprocessableEntityException(
      'Active site membership required on target site',
    );
  }

  const member = await prisma.tenantMember.findFirst({
    where: { tenant_id: tenantId, user_id: user.id, is_active: true },
    select: { id: true },
  });

  if (!member) {
    throw new UnprocessableEntityException(
      'Active site membership required on target site',
    );
  }

  const siteGrant = await prisma.siteMembership.findFirst({
    where: {
      tenant_id: tenantId,
      user_id: user.id,
      site_id: targetSiteId,
      is_active: true,
    },
    select: { id: true },
  });

  if (!siteGrant) {
    throw new UnprocessableEntityException(
      'Active site membership required on target site',
    );
  }
}

/**
 * Serializes site-level operations by locking participating site rows in
 * globally sorted site ID order and rechecking Site.is_active under that lock.
 *
 * Ruling 41 / ADR-0022 §3:
 * Two-site operations lock both sites in globally sorted site_id order
 * (then vehicle/transfer ids). Every caller-supplied target site must be
 * is_active or the write is 422.
 */
export async function lockSitesAndAssertActive(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteIds: string[],
): Promise<void> {
  const sorted = Array.from(new Set(siteIds.filter(Boolean))).sort();
  if (sorted.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- Ruling 41 site lock order
  const lockedSites = await tx.$queryRaw<
    Array<{ id: string; is_active: boolean }>
  >`
    SELECT id, is_active
    FROM sites
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sorted)})
    ORDER BY id
    FOR UPDATE
  `;

  if (lockedSites.length !== sorted.length) {
    throw new UnprocessableEntityException(
      'Target site not found in this tenant',
    );
  }

  const inactive = lockedSites.find((s) => !s.is_active);
  if (inactive) {
    throw new UnprocessableEntityException('Target site is inactive');
  }
}
