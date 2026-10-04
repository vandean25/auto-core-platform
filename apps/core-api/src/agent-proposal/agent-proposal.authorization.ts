import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';

export const SUPERVISOR_ROLES = new Set(['OWNER', 'ADMIN', 'ADVISOR', 'SALES']);

export function assertSupervisorAccess(
  tenantContext: TenantContextService,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (!user || !user.tenantId) {
    throw new ForbiddenException('Active tenant membership is required.');
  }

  const role = 'role' in user ? user.role : undefined;
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    throw new ForbiddenException(
      'Supervision access is restricted to OWNER, ADMIN, and ADVISOR / SALES roles only.',
    );
  }
}

@Injectable()
export class AgentProposalAuthorization {
  constructor(private readonly tenantContext: TenantContextService) {}

  assertSupervisor(): void {
    assertSupervisorAccess(this.tenantContext);
  }
}
