import { PublicEstimateApprovalRateLimiter } from './public-estimate-approval.rate-limit.js';

const WINDOW_MS = 10 * 60_000;
const START = Date.parse('2026-10-14T08:00:00.000Z');

describe('PublicEstimateApprovalRateLimiter', () => {
  it('allows up to the limit inside one window and refuses the next attempt', () => {
    const limiter = new PublicEstimateApprovalRateLimiter();

    const results = Array.from({ length: 4 }, () =>
      limiter.consume('read:token-a', 3, WINDOW_MS, START),
    );

    expect(results).toEqual([true, true, true, false]);
  });

  it('counts each key on its own', () => {
    const limiter = new PublicEstimateApprovalRateLimiter();

    expect(limiter.consume('decision:token-a', 1, WINDOW_MS, START)).toBe(true);
    expect(limiter.consume('decision:token-a', 1, WINDOW_MS, START)).toBe(
      false,
    );
    expect(limiter.consume('decision:token-b', 1, WINDOW_MS, START)).toBe(true);
  });

  it('starts a new window once the previous one has elapsed', () => {
    const limiter = new PublicEstimateApprovalRateLimiter();
    limiter.consume('read:token-a', 1, WINDOW_MS, START);
    expect(limiter.consume('read:token-a', 1, WINDOW_MS, START)).toBe(false);

    expect(
      limiter.consume('read:token-a', 1, WINDOW_MS, START + WINDOW_MS),
    ).toBe(true);
  });
});
