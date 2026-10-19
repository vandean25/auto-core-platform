import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

export function assertMcpStaffAvailabilityAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new ForbiddenException({
      code: 'not_permitted',
      message: 'Tenant admin access is required.',
    });
  }
}
