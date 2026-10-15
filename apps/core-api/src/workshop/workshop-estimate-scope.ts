import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import { assertSiteReadAccess } from '../site/site.authorization.js';

/**
 * Kostenvoranschlag actions and advisor decisions are for back-office roles (ADR-0025 §5). TECH sessions are
 * refused, and so is every role not on this list.
 */
export const ESTIMATE_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
]);

export type EstimateScope = { tenantId: string; siteId: string };

export function assertEstimateRole(tenantContext: TenantContextService): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || !ESTIMATE_ROLES.has(user.role)) {
    throw new ForbiddenException({
      code: 'ESTIMATE_ROLE_FORBIDDEN',
      message:
        'Kostenvoranschlag actions require the owner, admin or sales role.',
    });
  }
}

/** Role, tenant and active site of the request, with the site read check every estimate action runs. */
export async function resolveEstimateScope(deps: {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
}): Promise<EstimateScope> {
  assertEstimateRole(deps.tenantContext);
  const tenantId = await deps.tenantContext.getTenantId();
  const siteId = await deps.siteContext.getSiteId();
  await assertSiteReadAccess(deps.prisma, deps.tenantContext, tenantId, siteId);
  return { tenantId, siteId };
}

/** Same role set for a workshop action that is not an estimate action, such as resuming waiting tasks. */
export function assertBackOfficeRole(
  tenantContext: TenantContextService,
  action: string,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || !ESTIMATE_ROLES.has(user.role)) {
    throw new ForbiddenException({
      code: 'WORKSHOP_ROLE_FORBIDDEN',
      message: `${action} requires the owner, admin or sales role.`,
    });
  }
}

/**
 * The internal user id of the signed-in advisor, for evidence rows that reference users. The session carries the
 * Firebase uid, so the user is looked up in the active tenant (the same rule as the API key actor).
 */
export async function resolveActorUserId(deps: {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  tenantId: string;
}): Promise<string> {
  const firebaseUid = deps.tenantContext.getAuthenticatedUser()?.userId;
  const actor = firebaseUid
    ? await deps.prisma.user.findFirst({
        where: { firebaseUid, active_tenant_id: deps.tenantId },
        select: { id: true },
      })
    : null;
  if (!actor) {
    throw new ForbiddenException({
      code: 'ESTIMATE_ROLE_FORBIDDEN',
      message: 'Only a signed-in owner, admin or sales user can record this.',
    });
  }
  return actor.id;
}
