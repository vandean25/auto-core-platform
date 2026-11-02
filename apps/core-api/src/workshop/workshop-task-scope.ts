import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

export const WORKSHOP_ROLE_FORBIDDEN_CODE = 'WORKSHOP_ROLE_FORBIDDEN';

/**
 * Roles allowed to perform administrative task writes: create tasks, delete tasks,
 * modify line items, add lines from catalog, and stage/pick parts.
 */
export const WORKSHOP_TASK_WRITE_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
]);

/**
 * Roles allowed to execute or update tasks and inspection checklists (including mechanics / technicians).
 */
export const WORKSHOP_TASK_EXECUTION_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
  'TECH',
]);

export function assertWorkshopTaskWriteRole(
  tenantContext: TenantContextService,
  action: string,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || !WORKSHOP_TASK_WRITE_ROLES.has(user.role)) {
    throw new ForbiddenException({
      code: WORKSHOP_ROLE_FORBIDDEN_CODE,
      message: `${action} requires the owner, admin or sales role.`,
    });
  }
}

export function assertWorkshopTaskExecutionRole(
  tenantContext: TenantContextService,
  action: string,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || !WORKSHOP_TASK_EXECUTION_ROLES.has(user.role)) {
    throw new ForbiddenException({
      code: WORKSHOP_ROLE_FORBIDDEN_CODE,
      message: `${action} requires the owner, admin, sales or technician role.`,
    });
  }
}
