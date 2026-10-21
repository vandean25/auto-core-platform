import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { isApiKeyPrincipal } from '../auth/types/authenticated-user.js';

const CONSENT_LEDGER_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

export function assertConsentLedgerAccess(
  tenantContext: TenantContextService,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (isApiKeyPrincipal(user)) {
    throw new ForbiddenException(
      'Consent ledger access is not allowed for API keys.',
    );
  }
  if (!user?.role || !CONSENT_LEDGER_ROLES.has(user.role)) {
    throw new ForbiddenException(
      'Consent ledger access is not allowed for this role.',
    );
  }
}

export async function resolveControllerLegalEntityId(
  prisma: PrismaService,
  tenantId: string,
  requestedId?: string,
): Promise<string> {
  if (requestedId) {
    const entity = await prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, id: requestedId, is_active: true },
      select: { id: true },
    });
    if (!entity) {
      throw new NotFoundException('Controller legal entity not found.');
    }
    return entity.id;
  }

  const active = await prisma.legalEntity.findMany({
    where: { tenant_id: tenantId, is_active: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (active.length === 1) {
    return active[0].id;
  }
  throw new BadRequestException({
    code: 'COMMUNICATION_CONTROLLER_REQUIRED',
    message:
      'controller_legal_entity_id is required when more than one legal entity is active.',
  });
}

export async function assertCustomerInTenant(
  prisma: PrismaService,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { tenant_id: tenantId, id: customerId },
    select: { id: true },
  });
  if (!customer) {
    throw new NotFoundException('Customer not found.');
  }
}

/**
 * Ensures the authenticated principal has an active site membership for the controller legal entity.
 * Returns the tenant member id for ledger actor_member_id.
 */
export async function resolveConsentActorMemberId(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
  controllerLegalEntityId: string,
): Promise<string | null> {
  const authUser = tenantContext.getAuthenticatedUser();
  if (!authUser?.userId) {
    return null;
  }
  if (isApiKeyPrincipal(authUser)) {
    throw new ForbiddenException(
      'Active site membership is required for this controller.',
    );
  }

  const user = await prisma.user.findUnique({
    where: { firebaseUid: authUser.userId },
    select: { id: true },
  });
  if (!user) {
    throw new ForbiddenException(
      'Active site membership is required for this controller.',
    );
  }

  const member = await prisma.tenantMember.findFirst({
    where: { tenant_id: tenantId, user_id: user.id, is_active: true },
    select: { id: true },
  });
  if (!member) {
    throw new ForbiddenException(
      'Active site membership is required for this controller.',
    );
  }

  const siteGrant = await prisma.siteMembership.findFirst({
    where: {
      tenant_id: tenantId,
      user_id: user.id,
      is_active: true,
      site: {
        is_active: true,
        legal_entity_id: controllerLegalEntityId,
      },
    },
    select: { id: true },
  });
  if (!siteGrant) {
    throw new ForbiddenException(
      'Active site membership is required for this controller.',
    );
  }

  return member.id;
}
