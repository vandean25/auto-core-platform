import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

export function assertVehicleInspectionWriteAccess(
  tenantContext: TenantContextService,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || !WRITE_ROLES.has(user.role)) {
    throw new ForbiddenException(
      'Only OWNER, ADMIN, or SALES may modify vehicle inspection records.',
    );
  }
}
