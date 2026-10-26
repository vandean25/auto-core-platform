import { isSchedulerEnabled } from './scheduler-enabled.js';
import {
  isInProcessSchedulerMode,
  isSchedulerModeHttp,
  resolveSchedulerMode,
} from './scheduler-mode.js';

describe('resolveSchedulerMode', () => {
  it('defaults to in-process when unset', () => {
    expect(resolveSchedulerMode({})).toBe('in-process');
  });

  it('honours explicit SCHEDULER_MODE', () => {
    expect(resolveSchedulerMode({ SCHEDULER_MODE: 'http' })).toBe('http');
    expect(resolveSchedulerMode({ SCHEDULER_MODE: ' off ' })).toBe('off');
    expect(resolveSchedulerMode({ SCHEDULER_MODE: 'in-process' })).toBe(
      'in-process',
    );
  });

  it('treats unset SCHEDULER_MODE with SCHEDULER_ENABLED=false as off', () => {
    expect(
      resolveSchedulerMode({ SCHEDULER_ENABLED: 'false' }),
    ).toBe('off');
    expect(
      resolveSchedulerMode({
        SCHEDULER_ENABLED: ' FALSE ',
        SCHEDULER_MODE: 'in-process',
      }),
    ).toBe('in-process');
  });
});

describe('scheduler mode helpers', () => {
  it('maps modes to in-process cron registration', () => {
    expect(isInProcessSchedulerMode({ SCHEDULER_MODE: 'in-process' })).toBe(
      true,
    );
    expect(isInProcessSchedulerMode({ SCHEDULER_MODE: 'http' })).toBe(false);
    expect(isInProcessSchedulerMode({ SCHEDULER_ENABLED: 'false' })).toBe(
      false,
    );
    expect(isSchedulerModeHttp({ SCHEDULER_MODE: 'http' })).toBe(true);
    expect(isSchedulerEnabled({ SCHEDULER_MODE: 'http' })).toBe(false);
    expect(isSchedulerEnabled({})).toBe(true);
  });
});
