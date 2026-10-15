import {
  demoAccessExpiresAt,
  demoMagicLinkExpiresAt,
  isDemoMutationAllowed,
  isLandingDemoHoneypotTriggered,
} from './demo-role-restrictions.js';

describe('demo-role-restrictions', () => {
  it('allows read-only HTTP methods for demo users', () => {
    expect(isDemoMutationAllowed('GET', '/api/customers')).toBe(true);
    expect(isDemoMutationAllowed('HEAD', '/api/workshop/orders')).toBe(true);
  });

  it('blocks admin and settings mutations', () => {
    expect(isDemoMutationAllowed('POST', '/api/tenant-members/invite')).toBe(
      false,
    );
    expect(isDemoMutationAllowed('PATCH', '/api/settings/finance')).toBe(false);
    expect(isDemoMutationAllowed('POST', '/api/auth/switch-tenant')).toBe(
      false,
    );
  });

  it('blocks delete and external send/finalize routes', () => {
    expect(isDemoMutationAllowed('DELETE', '/api/customers/1')).toBe(false);
    expect(
      isDemoMutationAllowed('POST', '/api/workshop/estimates/1/send'),
    ).toBe(false);
    expect(
      isDemoMutationAllowed('POST', '/api/invoices/1/finalize'),
    ).toBe(false);
  });

  it('detects honeypot submissions', () => {
    expect(isLandingDemoHoneypotTriggered('')).toBe(false);
    expect(isLandingDemoHoneypotTriggered(undefined)).toBe(false);
    expect(isLandingDemoHoneypotTriggered('https://spam.test')).toBe(true);
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
