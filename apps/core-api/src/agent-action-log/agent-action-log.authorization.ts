import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';

@Injectable()
export class AgentActionLogAuthorization {
  constructor(private readonly tenantContext: TenantContextService) {}

  assertOwnerAdmin(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }
}
