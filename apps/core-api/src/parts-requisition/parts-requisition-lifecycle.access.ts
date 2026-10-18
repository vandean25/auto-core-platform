import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

export function assertBackOfficeAccess(
  tenantContext: TenantContextService,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (user?.role === 'TECH') {
    throw new ForbiddenException(
      'Mechanic-mode sessions may not access parts reservation endpoints.',
    );
  }
}
