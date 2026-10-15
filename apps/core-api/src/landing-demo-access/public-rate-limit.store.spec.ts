import { PublicRateLimitStore } from './public-rate-limit.store.js';

describe('PublicRateLimitStore', () => {
  it('allows the first request and blocks when the window is full', async () => {
    const future = new Date('2026-10-15T11:00:00.000Z');
    let count = 0;

    const systemPrisma = {
      publicRateLimitCounter: {
        updateMany: jest.fn(async () => {
          if (count >= 1) {
            return { count: 0 };
          }
          count += 1;
          return { count: 1 };
        }),
        findUnique: jest.fn(async () =>
          count > 0 ? { count, expires_at: future } : null,
        ),
        create: jest.fn(async () => {
          count = 1;
        }),
      },
    };

    const store = new PublicRateLimitStore(systemPrisma as never);
    const scope = { scope: 'test', key: 'a' };
    const window = { max: 1, ttlMs: 60_000 };
    const now = new Date('2026-10-15T10:00:00.000Z');

    const first = await store.consume(scope, window, now);
    expect(first.allowed).toBe(true);

    const second = await store.consume(scope, window, now);
    expect(second.allowed).toBe(false);
  });
});
