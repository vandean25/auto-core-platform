import type { Request } from 'express';
import {
  AUTH_ME_RATE_LIMIT,
  AUTH_SWITCH_TENANT_RATE_LIMIT,
  shouldThrottleAuthRoute,
} from './auth-throttling';

describe('auth throttling', () => {
  it('selects only auth routes after the API prefix', () => {
    expect(
      shouldThrottleAuthRoute({
        method: 'GET',
        originalUrl: '/api/auth/me',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'POST',
        originalUrl: '/api/auth/switch-tenant',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'GET',
        originalUrl: '/api/customers',
      } as Request),
    ).toBe(false);
  });

  it('defines a generous read bucket and tighter write bucket', () => {
    expect(AUTH_ME_RATE_LIMIT).toEqual({ limit: 120, ttl: 60_000 });
    expect(AUTH_SWITCH_TENANT_RATE_LIMIT).toEqual({
      limit: 10,
      ttl: 60_000,
    });
  });
});
