import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

export type PublicRateLimitScope = {
  scope: string;
  key: string;
};

export type PublicRateLimitWindow = {
  max: number;
  ttlMs: number;
};

export type PublicRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const MAX_CONSUME_ATTEMPTS = 3;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PublicRateLimitStore {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async consume(
    limit: PublicRateLimitScope,
    window: PublicRateLimitWindow,
    now: Date = new Date(),
  ): Promise<PublicRateLimitDecision> {
    for (let attempt = 0; attempt < MAX_CONSUME_ATTEMPTS; attempt++) {
      const decision = await this.tryConsume(limit, window, now);
      if (decision !== 'retry') {
        return decision;
      }
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(window.ttlMs / 1000),
    };
  }

  private async tryConsume(
    limit: PublicRateLimitScope,
    window: PublicRateLimitWindow,
    now: Date,
  ): Promise<PublicRateLimitDecision | 'retry'> {
    const nowMs = now.getTime();
    const expiresAt = new Date(nowMs + window.ttlMs);

    if (await this.incrementIfUnderLimit(limit, window.max, now)) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const existing = await this.systemPrisma.publicRateLimitCounter.findUnique({
      where: { scope_key: { scope: limit.scope, key: limit.key } },
      select: { count: true, expires_at: true },
    });

    if (existing && existing.expires_at.getTime() > nowMs) {
      if (existing.count >= window.max) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(
            (existing.expires_at.getTime() - nowMs) / 1000,
          ),
        };
      }
      return 'retry';
    }

    if (!existing) {
      try {
        await this.systemPrisma.publicRateLimitCounter.create({
          data: {
            scope: limit.scope,
            key: limit.key,
            count: 1,
            window_start: now,
            expires_at: expiresAt,
          },
        });
        return { allowed: true, retryAfterSeconds: 0 };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return 'retry';
        }
        throw error;
      }
    }

    const reset = await this.systemPrisma.publicRateLimitCounter.updateMany({
      where: {
        scope: limit.scope,
        key: limit.key,
        expires_at: { lte: now },
      },
      data: {
        count: 1,
        window_start: now,
        expires_at: expiresAt,
      },
    });

    if (reset.count === 1) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return 'retry';
  }

  private async incrementIfUnderLimit(
    limit: PublicRateLimitScope,
    max: number,
    now: Date,
  ): Promise<boolean> {
    const result = await this.systemPrisma.publicRateLimitCounter.updateMany({
      where: {
        scope: limit.scope,
        key: limit.key,
        expires_at: { gt: now },
        count: { lt: max },
      },
      data: { count: { increment: 1 } },
    });
    return result.count === 1;
  }
}
