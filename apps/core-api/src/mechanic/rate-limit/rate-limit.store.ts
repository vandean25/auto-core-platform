export const RATE_LIMIT_CLOCK = Symbol('RATE_LIMIT_CLOCK');

export interface Clock {
  now(): number;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
};

export type RateLimitScope = {
  tenantId: string;
  mechanicId: string;
};

export type RateLimitWindow = {
  max: number;
  ttlMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RateLimitEntry = {
  count: number;
  windowStart: number;
};

export abstract class RateLimitStore {
  abstract consume(
    scope: RateLimitScope,
    window: RateLimitWindow,
  ): Promise<RateLimitDecision>;
}
