import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

const BLOCKED_ROLES = new Set(['TECH', 'DEMO']);

export async function assertConsentLedgerAccess(
  tenantContext: TenantContextService,
): Promise<void> {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || BLOCKED_ROLES.has(user.role)) {
    throw new ForbiddenException('Consent ledger access is not allowed for this role.');
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

export type CommunicationStateRow = Prisma.CustomerCommunicationStateGetPayload<{
  select: { id: true; revision: true; processing_status: true };
}>;
