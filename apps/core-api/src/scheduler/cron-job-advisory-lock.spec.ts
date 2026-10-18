import type { Pool, PoolClient } from 'pg';
import {
  CORE_API_CRON_ADVISORY_LOCK_CLASS,
  cronJobAdvisoryLockKeys,
} from './cron-job-advisory-lock-key.js';
import { CORE_API_CRON_JOB_NAMES } from './core-api-cron-job-names.js';
import { withCronJobLock } from './cron-job-advisory-lock.js';

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
    expect(CORE_API_CRON_JOB_NAMES).toHaveLength(14);
  });
});

describe('withCronJobLock in-process guard', () => {
  it('skips a nested call for the same job name without taking a second lock', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { rows: [{ released: true }] };
      }
      return { rows: [] };
    });
    const client = { query, release: jest.fn() } as unknown as PoolClient;
    const pool = {
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;

    let nestedRan = false;
    const ran = await withCronJobLock(pool, 'nested-guard-test', async () => {
      const nested = await withCronJobLock(pool, 'nested-guard-test', async () => {
        nestedRan = true;
      });
      expect(nested).toBe(false);
    });

    expect(ran).toBe(true);
    expect(nestedRan).toBe(false);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
});
