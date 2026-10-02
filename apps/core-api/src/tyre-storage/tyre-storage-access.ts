import { ForbiddenException } from '@nestjs/common';
import type { TenantMemberRole } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

const WRITE_ROLES: ReadonlySet<TenantMemberRole> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
]);

const READ_ROLES: ReadonlySet<TenantMemberRole> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
  'TECH',
]);

export function assertTyreStorageRead(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role as
    | TenantMemberRole
    | undefined;
  if (!role || !READ_ROLES.has(role)) {
    throw new ForbiddenException('Tyre storage access is not permitted.');
  }
}

export function assertTyreStorageWrite(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role as
    | TenantMemberRole
    | undefined;
  if (!role || !WRITE_ROLES.has(role)) {
    throw new ForbiddenException(
      'Tyre storage changes are restricted to workshop desk roles.',
    );
  }
}
