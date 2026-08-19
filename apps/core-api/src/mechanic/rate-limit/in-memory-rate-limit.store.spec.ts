import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';
import type { Clock } from './rate-limit.store';

class FakeClock implements Clock {
  constructor(private currentMs: number) {}

  now(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

const SCOPE = { tenantId: 'tenant-a', mechanicId: 'mechanic-1' };
const OTHER_MECHANIC = { tenantId: 'tenant-a', mechanicId: 'mechanic-2' };
const OTHER_TENANT = { tenantId: 'tenant-b', mechanicId: 'mechanic-1' };
const LIMITS = { max: 2, ttlMs: 60_000 };

describe('InMemoryRateLimitStore', () => {
  it('allows consumes up to the configured max', async () => {
    const store = new InMemoryRateLimitStore(new FakeClock(1_000_000));

    await expect(store.consume(SCOPE, LIMITS)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    await expect(store.consume(SCOPE, LIMITS)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('rejects the consume that would exceed the max', async () => {
    const store = new InMemoryRateLimitStore(new FakeClock(1_000_000));

    await store.consume(SCOPE, LIMITS);
    await store.consume(SCOPE, LIMITS);

    await expect(store.consume(SCOPE, LIMITS)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('reports remaining window seconds as retryAfterSeconds', async () => {
    const clock = new FakeClock(1_000_000);
    const store = new InMemoryRateLimitStore(clock);

    await store.consume(SCOPE, LIMITS);
    await store.consume(SCOPE, LIMITS);
    clock.advance(15_000);

    await expect(store.consume(SCOPE, LIMITS)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 45,
    });
  });

  it('resets the window after TTL elapses', async () => {
    const clock = new FakeClock(1_000_000);
    const store = new InMemoryRateLimitStore(clock);

    await store.consume(SCOPE, { max: 1, ttlMs: 1_000 });
    await expect(
      store.consume(SCOPE, { max: 1, ttlMs: 1_000 }),
    ).resolves.toMatchObject({ allowed: false });

    clock.advance(1_000);

    await expect(
      store.consume(SCOPE, { max: 1, ttlMs: 1_000 }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('tracks mechanics and tenants independently', async () => {
    const store = new InMemoryRateLimitStore(new FakeClock(1_000_000));
    const tight = { max: 1, ttlMs: 60_000 };

    await store.consume(SCOPE, tight);

    await expect(store.consume(OTHER_MECHANIC, tight)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(store.consume(OTHER_TENANT, tight)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(store.consume(SCOPE, tight)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('shares the limit across two store instances using the same map', async () => {
    const clock = new FakeClock(1_000_000);
    const entries = new Map<string, { count: number; windowStart: number }>();
    const instanceA = new InMemoryRateLimitStore(clock, entries);
    const instanceB = new InMemoryRateLimitStore(clock, entries);

    await instanceA.consume(SCOPE, LIMITS);
    await instanceB.consume(SCOPE, LIMITS);

    await expect(instanceA.consume(SCOPE, LIMITS)).resolves.toMatchObject({
      allowed: false,
    });
  });
});
