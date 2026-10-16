import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { inspectionImportForbidden } from './inspection-exchange.errors.js';

const IMPORT_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

export function assertInspectionImportWriteAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!role || !IMPORT_ROLES.has(role)) {
    throw inspectionImportForbidden();
  }
}
