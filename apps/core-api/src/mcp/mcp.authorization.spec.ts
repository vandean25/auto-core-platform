import { ForbiddenException } from '@nestjs/common';
import {
  assertMcpTenantAccess,
  isMcpSupervisorRole,
} from './mcp.authorization.js';

describe('assertMcpTenantAccess', () => {
  it('allows OWNER, ADMIN, and SALES (ADVISOR)', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES'] as const) {
      expect(() =>
        assertMcpTenantAccess({
          userId: 'u1',
          email: 'a@example.com',
          tenantId: 't1',
          role,
        }),
      ).not.toThrow();
    }
  });

  it('rejects TECH and missing tenant', () => {
    expect(() =>
      assertMcpTenantAccess({
        userId: 'u1',
        email: 'a@example.com',
        tenantId: 't1',
        role: 'TECH',
      }),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertMcpTenantAccess({
        userId: 'u1',
        email: 'a@example.com',
        role: 'ADMIN',
      }),
    ).toThrow(ForbiddenException);
  });
});

describe('isMcpSupervisorRole', () => {
  it('allows only the tenant owner and admin', () => {
    expect(isMcpSupervisorRole('OWNER')).toBe(true);
    expect(isMcpSupervisorRole('ADMIN')).toBe(true);
  });

  it('refuses sales, technician, unknown, and missing roles', () => {
    expect(isMcpSupervisorRole('SALES')).toBe(false);
    expect(isMcpSupervisorRole('TECH')).toBe(false);
    expect(isMcpSupervisorRole('ADVISOR')).toBe(false);
    expect(isMcpSupervisorRole(undefined)).toBe(false);
    expect(isMcpSupervisorRole(null)).toBe(false);
  });
});
