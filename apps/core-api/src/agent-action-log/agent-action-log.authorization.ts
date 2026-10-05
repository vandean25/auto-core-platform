import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';

export const AGENT_ACTION_LOG_ROLES = ['OWNER', 'ADMIN', 'ADVISOR'] as const;

@Injectable()
export class AgentActionLogAuthorization {
  constructor(private readonly tenantContext: TenantContextService) {}

  assertSupervisorOrAdmin(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (
      !role ||
      !AGENT_ACTION_LOG_ROLES.includes(
        role as (typeof AGENT_ACTION_LOG_ROLES)[number],
      )
    ) {
      throw new ForbiddenException(
        'Tenant supervisor or admin access is required.',
      );
    }
  }

  assertOwnerAdmin(): void {
    this.assertSupervisorOrAdmin();
  }
}
