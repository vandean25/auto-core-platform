import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { isMcpSupervisorRole } from '../mcp/mcp.authorization.js';

/** OWNER and ADMIN may read the domain event feed (AUT-536). */
@Injectable()
export class DomainEventFeedAuthorization {
  constructor(private readonly tenantContext: TenantContextService) {}

  assertSupervisorOrAdmin(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (!role || !isMcpSupervisorRole(role)) {
      throw new ForbiddenException(
        'Domain event feed requires the owner or admin role.',
      );
    }
  }
}
