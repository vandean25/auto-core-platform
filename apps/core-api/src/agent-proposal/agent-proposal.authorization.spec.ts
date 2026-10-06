import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  AgentProposalAuthorization,
  assertSupervisorAccess,
} from './agent-proposal.authorization.js';

describe('AgentProposalAuthorization', () => {
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

      expect(() => assertSupervisorAccess(tenantContext)).not.toThrow();

      const auth = new AgentProposalAuthorization(tenantContext);
      expect(() => auth.assertSupervisor()).not.toThrow();
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

      expect(() => assertSupervisorAccess(tenantContext)).toThrow(
        ForbiddenException,
      );
    }
  });

  it('rejects unauthenticated or missing tenant membership', () => {
    const noUserContext = ({
      getAuthenticatedUser: jest.fn().mockReturnValue(undefined),
    }) as unknown as TenantContextService;

    expect(() => assertSupervisorAccess(noUserContext)).toThrow(
      ForbiddenException,
    );

    const noTenantContext = ({
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'u-platform',
        email: 'p@example.com',
        role: 'ADMIN',
      }),
    }) as unknown as TenantContextService;

    expect(() => assertSupervisorAccess(noTenantContext)).toThrow(
      ForbiddenException,
    );
  });
});
