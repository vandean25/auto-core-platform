import { jest } from '@jest/globals';
import type { Pool, PoolClient } from 'pg';
import {
  CORE_API_CRON_ADVISORY_LOCK_CLASS,
  cronJobAdvisoryLockKeys,
} from './cron-job-advisory-lock-key.js';
import { CORE_API_CRON_JOB_NAMES } from './core-api-cron-job-names.js';

const mockGetCronJobLockPool = jest.fn<() => Pool>();

jest.unstable_mockModule('./cron-job-lock-pool.js', () => ({
  getCronJobLockPool: mockGetCronJobLockPool,
}));

const { withCronJobLock } = await import('./cron-job-advisory-lock.js');

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

function mockLockPool() {
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
  const connect = jest
    .fn<() => Promise<PoolClient>>()
    .mockResolvedValue(client);
  const pool = { connect } as unknown as Pool;

  mockGetCronJobLockPool.mockReturnValue(pool);

  return { pool, connect, client, query };
}

describe('withCronJobLock in-process guard', () => {
  beforeEach(() => {
    mockGetCronJobLockPool.mockReset();
  });

  it('skips a nested call for the same job name without taking a second lock', async () => {
    const { connect } = mockLockPool();

    let nestedRan = false;
    const ran = await withCronJobLock('nested-guard-test', async () => {
      const nested = await withCronJobLock('nested-guard-test', async () => {
        nestedRan = true;
      });
      expect(nested).toBe(false);
    });

    expect(ran).toBe(true);
    expect(nestedRan).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent connect for the same job name', async () => {
    const { connect } = mockLockPool();
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });

    connect.mockImplementationOnce(async () => {
      await connectGate;
      return {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) {
            return { rows: [{ acquired: true }] };
          }
          if (sql.includes('pg_advisory_unlock')) {
            return { rows: [{ released: true }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      } as unknown as PoolClient;
    });

    const first = withCronJobLock('concurrent-guard-test', async () => {});
    const second = withCronJobLock('concurrent-guard-test', async () => {});

    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);

    releaseConnect();
    await Promise.all([first, second]);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
