import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RATE_LIMIT_CLOCK,
  RateLimitStore,
  SYSTEM_CLOCK,
  type Clock,
  type RateLimitDecision,
  type RateLimitScope,
  type RateLimitWindow,
} from './rate-limit.store';

const MAX_CONSUME_ATTEMPTS = 3;

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'P2002';
}

@Injectable()
export class PrismaRateLimitStore extends RateLimitStore {
  private readonly clock: Clock;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(RATE_LIMIT_CLOCK) clock?: Clock,
  ) {
    super();
    this.clock = clock ?? SYSTEM_CLOCK;
  }

  async consume(
    scope: RateLimitScope,
    window: RateLimitWindow,
  ): Promise<RateLimitDecision> {
    for (let attempt = 0; attempt < MAX_CONSUME_ATTEMPTS; attempt++) {
      const decision = await this.tryConsume(scope, window);
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
    scope: RateLimitScope,
    window: RateLimitWindow,
  ): Promise<RateLimitDecision | 'retry'> {
    const nowMs = this.clock.now();
    const now = new Date(nowMs);
    const expiresAt = new Date(nowMs + window.ttlMs);

    if (await this.incrementIfUnderLimit(scope, window.max, now)) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const existing = await this.findCounter(scope);
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
        await this.createCounter(scope, now, expiresAt);
        return { allowed: true, retryAfterSeconds: 0 };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return 'retry';
        }
        throw error;
      }
    }

    if (await this.resetExpiredCounter(scope, now, expiresAt)) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return 'retry';
  }

  private async incrementIfUnderLimit(
    scope: RateLimitScope,
    max: number,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.voiceNoteRateLimit.updateMany({
      where: {
        tenant_id: scope.tenantId,
        mechanic_id: scope.mechanicId,
        expires_at: { gt: now },
        count: { lt: max },
      },
      data: { count: { increment: 1 } },
    });
    return result.count === 1;
  }

  private findCounter(scope: RateLimitScope) {
    return this.prisma.voiceNoteRateLimit.findFirst({
      where: {
        tenant_id: scope.tenantId,
        mechanic_id: scope.mechanicId,
      },
      select: { count: true, expires_at: true },
    });
  }

  private createCounter(
    scope: RateLimitScope,
    windowStart: Date,
    expiresAt: Date,
  ) {
    return this.prisma.voiceNoteRateLimit.create({
      data: {
        tenant_id: scope.tenantId,
        mechanic_id: scope.mechanicId,
        window_start: windowStart,
        expires_at: expiresAt,
        count: 1,
      },
    });
  }

  private async resetExpiredCounter(
    scope: RateLimitScope,
    now: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.voiceNoteRateLimit.updateMany({
      where: {
        tenant_id: scope.tenantId,
        mechanic_id: scope.mechanicId,
        expires_at: { lte: now },
      },
      data: {
        count: 1,
        window_start: now,
        expires_at: expiresAt,
      },
    });
    return result.count === 1;
  }
}
