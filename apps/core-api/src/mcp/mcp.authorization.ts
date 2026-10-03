import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';

/** Tenant roles allowed to use the MCP read-only tools (ADVISOR ≡ SALES). */
export const MCP_ALLOWED_TENANT_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

export function assertMcpTenantAccess(user: AuthenticatedUser): void {
  if (!user.tenantId) {
    throw new ForbiddenException('MCP requires an active tenant membership');
  }
  const role = 'role' in user ? user.role : undefined;
  if (!role || !MCP_ALLOWED_TENANT_ROLES.has(role)) {
    throw new ForbiddenException(
      'MCP is available to OWNER, ADMIN, and ADVISOR (SALES) roles only',
    );
  }
}
