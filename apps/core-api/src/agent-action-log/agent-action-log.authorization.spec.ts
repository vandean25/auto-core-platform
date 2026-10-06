import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { AgentActionLogAuthorization } from './agent-action-log.authorization.js';

describe('AgentActionLogAuthorization', () => {
  const createMockTenantContext = (user?: {
    userId: string;
    email: string;
    tenantId: string;
    role?: string;
  }) =>
    ({
      getAuthenticatedUser: jest.fn().mockReturnValue(user),
    }) as unknown as TenantContextService;

  it('allows OWNER, ADMIN, and ADVISOR roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'ADVISOR']) {
      const tenantContext = createMockTenantContext({
        userId: 'u-1',
        email: 'user@example.com',
        tenantId: 't-1',
        role,
      });

      const auth = new AgentActionLogAuthorization(tenantContext);
      expect(() => auth.assertSupervisorOrAdmin()).not.toThrow();
      expect(() => auth.assertOwnerAdmin()).not.toThrow();
    }
  });

  it('rejects SALES and TECH roles with ForbiddenException', () => {
    for (const role of ['SALES', 'TECH']) {
      const tenantContext = createMockTenantContext({
        userId: `u-${role.toLowerCase()}`,
        email: `${role.toLowerCase()}@example.com`,
        tenantId: 't-1',
        role,
      });

      const auth = new AgentActionLogAuthorization(tenantContext);
      expect(() => auth.assertSupervisorOrAdmin()).toThrow(ForbiddenException);
    }
  });

  it('rejects unauthenticated user', () => {
    const noUserContext = ({
      getAuthenticatedUser: jest.fn().mockReturnValue(undefined),
    }) as unknown as TenantContextService;

    const auth = new AgentActionLogAuthorization(noUserContext);
    expect(() => auth.assertSupervisorOrAdmin()).toThrow(ForbiddenException);
  });
});
