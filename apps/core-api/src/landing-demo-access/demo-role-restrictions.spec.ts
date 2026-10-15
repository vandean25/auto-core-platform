import {
  demoAccessExpiresAt,
  demoMagicLinkExpiresAt,
  hashDemoEmail,
  isDemoMutationAllowed,
  isLandingDemoHoneypotTriggered,
  normalizeDemoEmail,
} from './demo-role-restrictions.js';

describe('demo-role-restrictions', () => {
  it('allows read-only HTTP methods for demo users', () => {
    expect(isDemoMutationAllowed('GET', '/api/customers')).toBe(true);
    expect(isDemoMutationAllowed('HEAD', '/api/workshop/orders')).toBe(true);
  });

  it('allows switch-tenant for mixed-membership users on demo sessions', () => {
    expect(isDemoMutationAllowed('POST', '/api/auth/switch-tenant')).toBe(true);
  });

  it('blocks admin, settings, sites, employees, and finance mutations', () => {
    expect(isDemoMutationAllowed('POST', '/api/tenant-members/invite')).toBe(
      false,
    );
    expect(isDemoMutationAllowed('PATCH', '/api/settings/finance')).toBe(false);
    expect(isDemoMutationAllowed('POST', '/api/sites')).toBe(false);
    expect(isDemoMutationAllowed('POST', '/api/employees')).toBe(false);
    expect(isDemoMutationAllowed('PATCH', '/api/finance/settings')).toBe(
      false,
    );
  });

  it('blocks delete, invoice issue, purchase pay, and external send routes', () => {
    expect(isDemoMutationAllowed('DELETE', '/api/customers/1')).toBe(false);
    expect(
      isDemoMutationAllowed('POST', '/api/workshop/estimates/1/send'),
    ).toBe(false);
    expect(
      isDemoMutationAllowed('POST', '/api/invoices/1/finalize'),
    ).toBe(false);
    expect(isDemoMutationAllowed('PATCH', '/api/purchase-invoices/1/pay')).toBe(
      false,
    );
    expect(isDemoMutationAllowed('POST', '/api/invoices/1/issue')).toBe(false);
  });

  it('allows safe workshop sandbox mutations', () => {
    expect(isDemoMutationAllowed('POST', '/api/workshop/orders')).toBe(true);
    expect(isDemoMutationAllowed('PATCH', '/api/customers/abc')).toBe(true);
    expect(isDemoMutationAllowed('PATCH', '/api/me/active-site')).toBe(true);
  });

  it('denies unknown mutation routes by default', () => {
    expect(isDemoMutationAllowed('POST', '/api/import/jobs')).toBe(false);
  });

  it('blocks procurement, settings, and draft-invoice sandbox escapes', () => {
    expect(isDemoMutationAllowed('PUT', '/api/tyre-sets/settings')).toBe(
      false,
    );
    expect(isDemoMutationAllowed('POST', '/api/labor/operations')).toBe(false);
    expect(isDemoMutationAllowed('POST', '/api/brands')).toBe(false);
    expect(
      isDemoMutationAllowed(
        'POST',
        '/api/parts-requisitions/abc/create-purchase-order',
      ),
    ).toBe(false);
    expect(
      isDemoMutationAllowed('POST', '/api/stock-transfers/abc/approve'),
    ).toBe(false);
    expect(
      isDemoMutationAllowed(
        'POST',
        '/api/workshop/orders/abc/create-invoice',
      ),
    ).toBe(false);
  });

  it('detects honeypot submissions', () => {
    expect(isLandingDemoHoneypotTriggered('')).toBe(false);
    expect(isLandingDemoHoneypotTriggered(undefined)).toBe(false);
    expect(isLandingDemoHoneypotTriggered('https://spam.test')).toBe(true);
  });

  it('hashes demo emails for rate-limit keys', () => {
    expect(hashDemoEmail('User@Example.com')).toHaveLength(64);
    expect(hashDemoEmail('user@example.com')).toBe(
      hashDemoEmail(normalizeDemoEmail('  USER@example.com  ')),
    );
  });

  it('computes demo expiry windows', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(demoMagicLinkExpiresAt(now).toISOString()).toBe(
      '2026-10-16T12:00:00.000Z',
    );
    expect(demoAccessExpiresAt(now).toISOString()).toBe(
      '2026-10-29T12:00:00.000Z',
    );
  });
});
