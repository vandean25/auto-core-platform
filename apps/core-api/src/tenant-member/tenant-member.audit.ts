import { InternalServerErrorException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import {
  buildAuditLogCreateData,
  type AuditActorContext,
} from '../prisma/prisma-audit.extension.js';

type AuditLogCreate = PrismaClient['auditLog']['create'];

export function membershipAuditActor(
  user: AuthenticatedUser | undefined,
): AuditActorContext {
  if (!user?.tenantId) {
    throw new InternalServerErrorException(
      'Tenant context not initialised. Is the JwtAuthGuard applied?',
    );
  }
  return {
    tenantId: user.tenantId,
    user,
    requestMeta: TenantContextStorage.getRequestMeta(),
  };
}

/** Membership columns only. The API include of `user` is not part of the history row. */
export function membershipAuditSnapshot(row: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'user'),
  );
}

export async function recordTenantMemberAudit(
  auditLog: { create: AuditLogCreate },
  input: {
    actor: AuditActorContext;
    action: 'CREATE' | 'UPDATE';
    entityId: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  const data = buildAuditLogCreateData({
    actor: input.actor,
    model: 'TenantMember',
    entityId: input.entityId,
    action: input.action,
    before: input.before,
    after: input.after,
  });
  if (!data) {
    return;
  }
  await auditLog.create({
    data: data as Prisma.AuditLogUncheckedCreateInput,
  });
}
