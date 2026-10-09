import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePublicApiScope } from '../decorators/require-public-api-scope.decorator.js';
import { ApiKeyAuthGuard } from './api-key.guard.js';

class SampleController {
  @RequirePublicApiScope('customers:read')
  scoped(): void {}

  unmapped(): void {}

  @Public()
  open(): void {}
}

const TOKEN = 'acp_live_3f9a2c1b-7d4e-4f2a-9b8c-1234567890ab_' + 'c'.repeat(64);
const PRINCIPAL = {
  apiKeyId: '3f9a2c1b-7d4e-4f2a-9b8c-1234567890ab',
  tenantId: 'tenant-a',
  keyPrefix: 'acp_live_3f9a2c1b',
  scopes: ['customers:read'],
  expiresAt: null,
  revokedAt: null,
  rateLimitPerMinute: 60,
};

function createContext(
  handler: keyof SampleController,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
) {
  const response = { setHeader: jest.fn() };
  const request: Record<string, unknown> = {
    headers,
    method: 'GET',
    path: '/api/public/v1/customers',
    route: { path: '/api/public/v1/customers' },
  };
  const context = {
    getHandler: () => SampleController.prototype[handler],
    getClass: () => SampleController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, request, response };
}

describe('ApiKeyAuthGuard', () => {
  let authenticator: {
    verifyToken: jest.Mock;
    consumeRateLimit: jest.Mock;
    touchLastUsed: jest.Mock;
  };
  let tenantContext: { setAuthenticatedUser: jest.Mock };
  let audit: { record: jest.Mock };
  let guard: ApiKeyAuthGuard;

  beforeEach(() => {
    authenticator = {
      verifyToken: jest.fn().mockResolvedValue(PRINCIPAL),
      consumeRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    };
    tenantContext = { setAuthenticatedUser: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    guard = new ApiKeyAuthGuard(
      new Reflector(),
      authenticator as never,
      tenantContext as never,
      audit as never,
    );
  });

  it('ignores requests without a Bearer token so the session guard can decide', async () => {
    const { context } = createContext('scoped', {});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticator.verifyToken).not.toHaveBeenCalled();
  });

  it('ignores Firebase-style bearer tokens', async () => {
    const { context } = createContext('scoped', { authorization: 'Bearer eyJhbGciOi.jwt.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticator.verifyToken).not.toHaveBeenCalled();
  });

  it('ignores API keys on @Public routes', async () => {
    const { context } = createContext('open');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticator.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid key with 401 and records nothing, because the key is not attributable', async () => {
    authenticator.verifyToken.mockRejectedValue(new UnauthorizedException('Invalid API key.'));
    const { context } = createContext('scoped');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a revoked key with 401 and audits the refusal', async () => {
    authenticator.verifyToken.mockResolvedValue({
      ...PRINCIPAL,
      revokedAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    const { context } = createContext('scoped');

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid API key.');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ httpStatus: 401, outcome: 'REFUSED', reason: 'revoked_or_expired' }),
    );
    expect(authenticator.touchLastUsed).not.toHaveBeenCalled();
  });

  it('rejects an expired key with 401', async () => {
    authenticator.verifyToken.mockResolvedValue({
      ...PRINCIPAL,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    const { context } = createContext('scoped');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a key on an unmapped route with 403 (deny by default) and audits it', async () => {
    const { context } = createContext('unmapped');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ scope: null, httpStatus: 403, reason: 'unmapped_endpoint' }),
    );
    expect(authenticator.consumeRateLimit).not.toHaveBeenCalled();
  });

  it('rejects a key that lacks the route scope with 403 and audits it', async () => {
    authenticator.verifyToken.mockResolvedValue({ ...PRINCIPAL, scopes: ['stock:read'] });
    const { context } = createContext('scoped');

    await expect(guard.canActivate(context)).rejects.toThrow('customers:read');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'customers:read', httpStatus: 403, reason: 'missing_scope' }),
    );
  });

  it('returns 429 with Retry-After when the per-key budget is spent', async () => {
    authenticator.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    const { context, response } = createContext('scoped');

    const error = await guard.canActivate(context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '17');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ httpStatus: 429, outcome: 'REFUSED', reason: 'rate_limited' }),
    );
  });

  it('admits a valid key with the scope, marks the request as an API-key principal, and sets tenant context', async () => {
    const { context, request } = createContext('scoped');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(authenticator.consumeRateLimit).toHaveBeenCalledWith(PRINCIPAL, expect.any(Date));
    expect(authenticator.touchLastUsed).toHaveBeenCalledWith(PRINCIPAL, expect.any(Date));
    expect(request.user).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-a',
        role: 'API_KEY',
        apiKeyId: PRINCIPAL.apiKeyId,
      }),
    );
    expect(tenantContext.setAuthenticatedUser).toHaveBeenCalledWith(request.user);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
