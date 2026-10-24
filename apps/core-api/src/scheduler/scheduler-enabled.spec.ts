import { isSchedulerEnabled } from './scheduler-enabled.js';

describe('isSchedulerEnabled', () => {
  it('defaults to enabled when SCHEDULER_ENABLED is unset or blank', () => {
    expect(isSchedulerEnabled({})).toBe(true);
    expect(isSchedulerEnabled({ SCHEDULER_ENABLED: '  ' })).toBe(true);
  });

  it('is disabled only for an explicit false (case/space insensitive)', () => {
    expect(isSchedulerEnabled({ SCHEDULER_ENABLED: 'false' })).toBe(false);
    expect(isSchedulerEnabled({ SCHEDULER_ENABLED: ' FALSE ' })).toBe(false);
    expect(isSchedulerEnabled({ SCHEDULER_ENABLED: 'true' })).toBe(true);
  });
});
