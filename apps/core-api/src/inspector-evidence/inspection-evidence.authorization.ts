import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { inspectorEvidenceForbidden } from './inspection-evidence.errors.js';

const MANAGEMENT_ROLES = new Set(['OWNER', 'ADMIN']);

export function assertInspectorEvidenceManagementAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!role || !MANAGEMENT_ROLES.has(role)) {
    throw inspectorEvidenceForbidden();
  }
}

export function canReadInspectorEvidenceAssessment(
  tenantContext: TenantContextService,
  employeeUserId: string | null,
): 'full' | 'minimal' | 'none' {
  const auth = tenantContext.getAuthenticatedUser();
  if (!auth?.role) {
    return 'none';
  }
  if (MANAGEMENT_ROLES.has(auth.role)) {
    return 'full';
  }
  if (employeeUserId && auth.userId === employeeUserId) {
    return 'minimal';
  }
  return 'none';
}
