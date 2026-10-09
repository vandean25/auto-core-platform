import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';

/** Same supervisor gate as agent action logs. TECH and SALES are denied. */
export const DECISION_SHADOW_LOG_ROLES = ['OWNER', 'ADMIN', 'ADVISOR'] as const;

@Injectable()
export class DecisionShadowLogAuthorization {
  constructor(private readonly tenantContext: TenantContextService) {}

  assertSupervisorOrAdmin(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (
      !role ||
      !DECISION_SHADOW_LOG_ROLES.includes(
        role as (typeof DECISION_SHADOW_LOG_ROLES)[number],
      )
    ) {
      throw new ForbiddenException(
        'Tenant supervisor or admin access is required.',
      );
    }
  }
}
