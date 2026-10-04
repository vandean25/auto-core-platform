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

  it('allows OWNER, ADMIN, ADVISOR, and SALES roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'ADVISOR', 'SALES']) {
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

  it('rejects TECH role with ForbiddenException', () => {
    const tenantContext = createMockTenantContext({
      userId: 'u-tech',
      email: 'tech@example.com',
      tenantId: 't-1',
      role: 'TECH',
    });

    expect(() => assertSupervisorAccess(tenantContext)).toThrow(
      ForbiddenException,
    );
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
