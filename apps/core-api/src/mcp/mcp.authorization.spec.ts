import { ForbiddenException } from '@nestjs/common';
import { assertMcpTenantAccess } from './mcp.authorization.js';

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
