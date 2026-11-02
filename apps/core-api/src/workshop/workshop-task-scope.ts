import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { ESTIMATE_ROLES } from './workshop-estimate-scope.js';

export const WORKSHOP_ROLE_FORBIDDEN_CODE = 'WORKSHOP_ROLE_FORBIDDEN';

/**
 * Roles allowed to execute or update tasks and inspection checklists (including mechanics / technicians).
 * Back-office task writes use `assertWorkshopTaskWriteRole` instead.
 */
export const WORKSHOP_TASK_EXECUTION_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
  'TECH',
]);

/**
 * Workshop task writes follow the workshop order demo allowlist (AUT-847): the back-office set plus
 * DEMO, derived from `ESTIMATE_ROLES` so estimates and task writes cannot drift apart.
 */
export const WORKSHOP_TASK_WRITE_ROLES: ReadonlySet<string> = new Set([
  ...ESTIMATE_ROLES,
  'DEMO',
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
