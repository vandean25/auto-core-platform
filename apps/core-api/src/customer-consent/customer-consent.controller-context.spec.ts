import { ForbiddenException } from '@nestjs/common';
import { assertConsentLedgerAccess } from './customer-consent.controller-context.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

describe('assertConsentLedgerAccess', () => {
  it('denies API key principals', () => {
    const tenantContext = {
      getAuthenticatedUser: () => ({
        userId: 'key',
        email: '',
        tenantId: 't1',
        role: 'API_KEY',
        apiKeyId: 'ak-1',
      }),
    } as TenantContextService;

    expect(() => assertConsentLedgerAccess(tenantContext)).toThrow(
      ForbiddenException,
    );
  });

  it('allows SALES role', () => {
    const tenantContext = {
      getAuthenticatedUser: () => ({
        userId: 'u1',
        email: 'a@b.c',
        tenantId: 't1',
        role: 'SALES',
      }),
    } as TenantContextService;

    expect(() => assertConsentLedgerAccess(tenantContext)).not.toThrow();
  });
});
