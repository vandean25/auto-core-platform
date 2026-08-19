import {
  RateLimitStore,
  SYSTEM_CLOCK,
  type Clock,
  type RateLimitDecision,
  type RateLimitEntry,
  type RateLimitScope,
  type RateLimitWindow,
} from './rate-limit.store';

function rateLimitKey(scope: RateLimitScope): string {
  return `${scope.tenantId}:${scope.mechanicId}`;
}

export class InMemoryRateLimitStore extends RateLimitStore {
  constructor(
    private readonly clock: Clock = SYSTEM_CLOCK,
    private readonly entries: Map<string, RateLimitEntry> = new Map(),
  ) {
    super();
  }

  consume(
    scope: RateLimitScope,
    window: RateLimitWindow,
  ): Promise<RateLimitDecision> {
    return Promise.resolve(this.consumeSync(scope, window));
  }

  private consumeSync(
    scope: RateLimitScope,
    window: RateLimitWindow,
  ): RateLimitDecision {
    const now = this.clock.now();
    this.deleteExpiredEntries(now, window.ttlMs);

    const key = rateLimitKey(scope);
    const entry = this.entries.get(key);

    if (!entry) {
      this.entries.set(key, { count: 1, windowStart: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (entry.count >= window.max) {
      return {
        allowed: false,
        retryAfterSeconds: remainingWindowSeconds(
          entry.windowStart,
          window.ttlMs,
          now,
        ),
      };
    }

    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private deleteExpiredEntries(now: number, ttlMs: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStart >= ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}

function remainingWindowSeconds(
  windowStart: number,
  ttlMs: number,
  now: number,
): number {
  return Math.ceil((ttlMs - (now - windowStart)) / 1000);
}
