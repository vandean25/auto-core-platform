import {
  NOTIFICATION_MAX_ATTEMPTS,
  nextRetryDelaySeconds,
} from './notification-retry.policy.js';

describe('nextRetryDelaySeconds()', () => {
  it('backs off after each failed attempt and stops at the attempt limit', () => {
    expect(NOTIFICATION_MAX_ATTEMPTS).toBe(5);
    expect(nextRetryDelaySeconds(1)).toBe(60);
    expect(nextRetryDelaySeconds(2)).toBe(300);
    expect(nextRetryDelaySeconds(3)).toBe(900);
    expect(nextRetryDelaySeconds(4)).toBe(3600);
    expect(nextRetryDelaySeconds(5)).toBeNull();
  });

  it('refuses a count below one', () => {
    expect(nextRetryDelaySeconds(0)).toBeNull();
  });
});
