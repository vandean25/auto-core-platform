import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyAuthenticatorService } from './api-key-authenticator.service.js';
import {
  API_KEY_HASH_VERSION,
  buildApiKeyDisplayPrefix,
  createApiKeyCredentials,
  hashApiKeySecret,
} from './api-key-token.js';

const PEPPER = Buffer.alloc(32, 5);
const NOW = new Date('2026-10-09T10:00:00.000Z');

type Credentials = ReturnType<typeof createApiKeyCredentials>;

function storedRow(credentials: Credentials, overrides: Record<string, unknown> = {}) {
  return {
    id: credentials.keyId,
    tenant_id: 'tenant-a',
    key_prefix: buildApiKeyDisplayPrefix(credentials.keyId),
    secret_hash: hashApiKeySecret(credentials.keyId, credentials.secret, PEPPER),
    hash_version: API_KEY_HASH_VERSION,
    scopes: ['customers:read'],
    expires_at: null,
    revoked_at: null,
    tenant: { is_active: true, api_rate_limit_per_minute: 60 },
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    tenantApiKey: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function principalFrom(credentials: Credentials) {
  return {
    apiKeyId: credentials.keyId,
    tenantId: 'tenant-a',
    keyPrefix: buildApiKeyDisplayPrefix(credentials.keyId),
    scopes: ['customers:read'],
    expiresAt: null,
    revokedAt: null,
    rateLimitPerMinute: 60,
  };
}

describe('ApiKeyAuthenticatorService', () => {
  const originalPepper = process.env.API_KEY_PEPPER;
  const originalNodeEnv = process.env.NODE_ENV;
  let prisma: ReturnType<typeof createPrismaMock>;
  let lookup: { findForVerification: jest.Mock };
  let service: ApiKeyAuthenticatorService;

  beforeEach(() => {
    process.env.API_KEY_PEPPER = PEPPER.toString('base64');
    process.env.NODE_ENV = 'test';
    prisma = createPrismaMock();
    lookup = { findForVerification: jest.fn() };
    service = new ApiKeyAuthenticatorService(prisma as never, lookup as never);
  });

  afterEach(() => {
    restoreEnv('API_KEY_PEPPER', originalPepper);
    restoreEnv('NODE_ENV', originalNodeEnv);
  });

  describe('verifyToken', () => {
    it('returns the principal for a valid token without reading the secret back', async () => {
      const credentials = createApiKeyCredentials();
      lookup.findForVerification.mockResolvedValue(storedRow(credentials));

      const principal = await service.verifyToken(credentials.token);

      expect(principal).toEqual(principalFrom(credentials));
      expect(lookup.findForVerification).toHaveBeenCalledWith(credentials.keyId);
      expect(JSON.stringify(principal)).not.toContain(credentials.secret);
    });

    it('rejects a malformed token without touching the database', async () => {
      await expect(service.verifyToken('acp_live_nope')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(lookup.findForVerification).not.toHaveBeenCalled();
    });

    it('rejects an unknown key id with the same generic message', async () => {
      const credentials = createApiKeyCredentials();
      lookup.findForVerification.mockResolvedValue(null);

      await expect(service.verifyToken(credentials.token)).rejects.toThrow(
        'Invalid API key.',
      );
    });

    it('rejects a wrong secret for a known key id with the same generic message', async () => {
      const credentials = createApiKeyCredentials();
      const other = createApiKeyCredentials();
      lookup.findForVerification.mockResolvedValue(storedRow(credentials));

      await expect(
        service.verifyToken(
          `acp_live_${credentials.keyId}_${other.secret}`,
        ),
      ).rejects.toThrow('Invalid API key.');
    });

    it('rejects a key whose tenant is inactive', async () => {
      const credentials = createApiKeyCredentials();
      lookup.findForVerification.mockResolvedValue(
        storedRow(credentials, { tenant: { is_active: false, api_rate_limit_per_minute: 60 } }),
      );

      await expect(service.verifyToken(credentials.token)).rejects.toThrow(
        'Invalid API key.',
      );
    });

    it('rejects an unknown digest version instead of guessing the scheme', async () => {
      const credentials = createApiKeyCredentials();
      lookup.findForVerification.mockResolvedValue(
        storedRow(credentials, { hash_version: 99 }),
      );

      await expect(service.verifyToken(credentials.token)).rejects.toThrow(
        'Invalid API key.',
      );
    });

    it('fails closed when no pepper is configured outside tests', async () => {
      const credentials = createApiKeyCredentials();
      lookup.findForVerification.mockResolvedValue(storedRow(credentials));
      delete process.env.API_KEY_PEPPER;
      process.env.NODE_ENV = 'production';

      await expect(service.verifyToken(credentials.token)).rejects.toThrow(
        'Invalid API key.',
      );
    });
  });

  describe('consumeRateLimit (fixed one-minute window per key)', () => {
    const principal = principalFrom(createApiKeyCredentials());

    it('counts a request inside the active window when the budget is not spent', async () => {
      prisma.tenantApiKey.updateMany.mockResolvedValueOnce({ count: 1 });

      const decision = await service.consumeRateLimit(principal, NOW);

      expect(decision).toEqual({ allowed: true, retryAfterSeconds: 0 });
      expect(prisma.tenantApiKey.updateMany).toHaveBeenCalledWith({
        where: {
          id: principal.apiKeyId,
          tenant_id: principal.tenantId,
          rate_window_expires_at: { gt: NOW },
          rate_window_count: { lt: 60 },
        },
        data: { rate_window_count: { increment: 1 } },
      });
    });

    it('opens a new window when no window is active', async () => {
      prisma.tenantApiKey.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const decision = await service.consumeRateLimit(principal, NOW);

      expect(decision.allowed).toBe(true);
      expect(prisma.tenantApiKey.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: principal.apiKeyId,
          tenant_id: principal.tenantId,
          OR: [
            { rate_window_expires_at: null },
            { rate_window_expires_at: { lte: NOW } },
          ],
        },
        data: {
          rate_window_count: 1,
          rate_window_expires_at: new Date(NOW.getTime() + 60_000),
        },
      });
    });

    it('denies with Retry-After seconds until the active window resets', async () => {
      prisma.tenantApiKey.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.tenantApiKey.findFirst.mockResolvedValue({
        rate_window_expires_at: new Date(NOW.getTime() + 17_200),
      });

      const decision = await service.consumeRateLimit(principal, NOW);

      expect(decision).toEqual({ allowed: false, retryAfterSeconds: 18 });
    });

    it('never reports a zero or negative Retry-After', async () => {
      prisma.tenantApiKey.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.tenantApiKey.findFirst.mockResolvedValue({
        rate_window_expires_at: new Date(NOW.getTime() - 5_000),
      });

      const decision = await service.consumeRateLimit(principal, NOW);

      expect(decision.allowed).toBe(false);
      expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });
  });

  describe('touchLastUsed (throttled to one write per five minutes)', () => {
    it('writes last_used_at only when it is null or older than five minutes', async () => {
      const principal = principalFrom(createApiKeyCredentials());
      prisma.tenantApiKey.updateMany.mockResolvedValue({ count: 1 });

      await service.touchLastUsed(principal, NOW);

      expect(prisma.tenantApiKey.updateMany).toHaveBeenCalledWith({
        where: {
          id: principal.apiKeyId,
          tenant_id: principal.tenantId,
          revoked_at: null,
          OR: [
            { last_used_at: null },
            { last_used_at: { lt: new Date(NOW.getTime() - 5 * 60_000) } },
          ],
        },
        data: { last_used_at: NOW },
      });
    });
  });
});

function restoreEnv(key: 'API_KEY_PEPPER' | 'NODE_ENV', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
