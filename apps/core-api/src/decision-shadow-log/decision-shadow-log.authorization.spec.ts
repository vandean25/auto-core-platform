import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { DecisionShadowLogAuthorization } from './decision-shadow-log.authorization.js';

describe('DecisionShadowLogAuthorization', () => {
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
      const auth = new DecisionShadowLogAuthorization(
        createMockTenantContext({
          userId: 'u-1',
          email: 'user@example.org',
          tenantId: 't-1',
          role,
        }),
      );
      expect(() => auth.assertSupervisorOrAdmin()).not.toThrow();
    }
  });

  it('rejects TECH and SALES roles with ForbiddenException', () => {
    for (const role of ['TECH', 'SALES']) {
      const auth = new DecisionShadowLogAuthorization(
        createMockTenantContext({
          userId: `u-${role.toLowerCase()}`,
          email: `${role.toLowerCase()}@example.org`,
          tenantId: 't-1',
          role,
        }),
      );
      expect(() => auth.assertSupervisorOrAdmin()).toThrow(ForbiddenException);
    }
  });

  it('rejects unauthenticated user', () => {
    const auth = new DecisionShadowLogAuthorization(
      createMockTenantContext(undefined),
    );
    expect(() => auth.assertSupervisorOrAdmin()).toThrow(ForbiddenException);
  });
});
