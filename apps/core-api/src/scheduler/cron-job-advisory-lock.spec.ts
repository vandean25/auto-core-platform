import {
  CORE_API_CRON_ADVISORY_LOCK_CLASS,
  cronJobAdvisoryLockKeys,
} from './cron-job-advisory-lock-key.js';
import { CORE_API_CRON_JOB_NAMES } from './core-api-cron-job-names.js';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

describe('cronJobAdvisoryLockKeys', () => {
  it('is stable for a given job name', () => {
    expect(cronJobAdvisoryLockKeys('notification-outbox-recovery')).toEqual(
      cronJobAdvisoryLockKeys('notification-outbox-recovery'),
    );
    expect(cronJobAdvisoryLockKeys('hr-shift-close')).not.toEqual(
      cronJobAdvisoryLockKeys('mechanic-shift-close'),
    );
  });

  it('covers every documented core-api cron name with unique int4 keys', () => {
    const keys = new Set<string>();
    for (const name of CORE_API_CRON_JOB_NAMES) {
      const [key1, key2] = cronJobAdvisoryLockKeys(name);
      expect(key1).toBe(CORE_API_CRON_ADVISORY_LOCK_CLASS);
      expect(key2).toBeGreaterThanOrEqual(INT32_MIN);
      expect(key2).toBeLessThanOrEqual(INT32_MAX);
      const encoded = `${key1}:${key2}`;
      expect(keys.has(encoded)).toBe(false);
      keys.add(encoded);
    }
    expect(CORE_API_CRON_JOB_NAMES).toHaveLength(13);
  });
});
