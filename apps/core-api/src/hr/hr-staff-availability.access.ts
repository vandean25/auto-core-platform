import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  isMcpToolAllowed,
  legacyAccessOfRole,
} from '../permissions/permission-resolver.js';

const STAFF_AVAILABILITY_TOOL = 'get_staff_availability';

/** The tool's permission entry decides, so the call accepts exactly the roles the catalog lists. */
export function assertMcpStaffAvailabilityAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!isMcpToolAllowed(STAFF_AVAILABILITY_TOOL, legacyAccessOfRole(role))) {
    throw new ForbiddenException({
      code: 'not_permitted',
      message: 'Tenant admin access is required.',
    });
  }
}
