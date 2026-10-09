import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiKeyLookupService } from './api-key-lookup.service.js';
import type { ApiKeyPrincipal } from './api-key-principal.js';
import { resolveApiKeyPepper } from './api-key-pepper.js';
import {
  API_KEY_HASH_VERSION,
  buildApiKeyDisplayPrefix,
  parseApiKeyToken,
  verifyApiKeySecret,
} from './api-key-token.js';

const RATE_WINDOW_MS = 60_000;
const LAST_USED_THROTTLE_MS = 5 * 60_000;

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Verifies API key tokens and enforces the per-key budget (ADR-0026).
 *
 * Every failure to verify the secret raises the same 401, so a caller cannot tell an unknown id from a
 * wrong secret or an unconfigured pepper.
 */
@Injectable()
export class ApiKeyAuthenticatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: ApiKeyLookupService,
  ) {}

  async verifyToken(token: string): Promise<ApiKeyPrincipal> {
    const parsed = parseApiKeyToken(token);
    if (!parsed) {
      throw invalidApiKey();
    }

    // The key row names its tenant, so this read happens before any tenant context exists. Everything after
    // it runs with the resolved tenant set on the request.
    const row = await this.lookup.findForVerification(parsed.keyId);
    if (!row || !row.tenant.is_active) {
      throw invalidApiKey();
    }

    const pepper = resolveApiKeyPepper();
    if (!pepper || row.hash_version !== API_KEY_HASH_VERSION) {
      throw invalidApiKey();
    }
    if (!verifyApiKeySecret(row.id, parsed.secret, row.secret_hash, pepper)) {
      throw invalidApiKey();
    }

    return {
      apiKeyId: row.id,
      tenantId: row.tenant_id,
      keyPrefix: row.key_prefix || buildApiKeyDisplayPrefix(row.id),
      scopes: row.scopes,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      rateLimitPerMinute: row.tenant.api_rate_limit_per_minute,
    };
  }

  /**
   * Fixed one-minute window per key. Each step is one conditional UPDATE, so concurrent requests
   * cannot overspend the budget. A conservative denial at a window boundary is acceptable.
   */
  async consumeRateLimit(
    principal: ApiKeyPrincipal,
    now: Date,
  ): Promise<RateLimitDecision> {
    const scope = { id: principal.apiKeyId, tenant_id: principal.tenantId };
    const limit = principal.rateLimitPerMinute;

    const counted = await this.prisma.tenantApiKey.updateMany({
      where: {
        ...scope,
        rate_window_expires_at: { gt: now },
        rate_window_count: { lt: limit },
      },
      data: { rate_window_count: { increment: 1 } },
    });
    if (counted.count === 1) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const started = await this.prisma.tenantApiKey.updateMany({
      where: {
        ...scope,
        OR: [
          { rate_window_expires_at: null },
          { rate_window_expires_at: { lte: now } },
        ],
      },
      data: {
        rate_window_count: 1,
        rate_window_expires_at: new Date(now.getTime() + RATE_WINDOW_MS),
      },
    });
    if (started.count === 1) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const active = await this.prisma.tenantApiKey.findFirst({
      where: scope,
      select: { rate_window_expires_at: true },
    });
    const resetAt =
      active?.rate_window_expires_at ??
      new Date(now.getTime() + RATE_WINDOW_MS);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  /** Writes last_used_at at most once per five minutes per key. The write is conditional, so it is atomic. */
  async touchLastUsed(principal: ApiKeyPrincipal, now: Date): Promise<void> {
    await this.prisma.tenantApiKey.updateMany({
      where: {
        id: principal.apiKeyId,
        tenant_id: principal.tenantId,
        revoked_at: null,
        OR: [
          { last_used_at: null },
          {
            last_used_at: {
              lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS),
            },
          },
        ],
      },
      data: { last_used_at: now },
    });
  }
}

function invalidApiKey(): UnauthorizedException {
  return new UnauthorizedException('Invalid API key.');
}
