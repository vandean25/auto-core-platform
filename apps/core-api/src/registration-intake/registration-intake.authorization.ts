import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { ESTIMATE_ROLES } from '../workshop/workshop-estimate-scope.js';
import { registrationIntakeRoleForbidden } from './registration-intake.errors.js';

export function assertRegistrationIntakeRole(
  tenantContext: TenantContextService,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user?.role || !ESTIMATE_ROLES.has(user.role)) {
    throw registrationIntakeRoleForbidden();
  }
}
