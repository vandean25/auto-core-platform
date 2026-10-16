import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { catalogueImportForbidden } from './inspection-catalog.errors.js';

const ACTIVATION_ROLES = new Set(['OWNER', 'ADMIN']);
const READ_ROLES = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
  'MECHANIC',
  'PARTS_CLERK',
  'SERVICE_ADVISOR',
]);

export function assertCatalogueActivationAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!role || !ACTIVATION_ROLES.has(role)) {
    throw catalogueImportForbidden();
  }
}

export function assertCatalogueReadAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!role || !READ_ROLES.has(role)) {
    throw catalogueImportForbidden();
  }
}
