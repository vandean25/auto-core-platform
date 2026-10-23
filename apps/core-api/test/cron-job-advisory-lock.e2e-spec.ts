import { Pool } from 'pg';
import { cronJobAdvisoryLockKeys } from '../src/scheduler/cron-job-advisory-lock-key.js';
import { withCronJobLock } from '../src/scheduler/cron-job-advisory-lock.js';
import {
  getCronJobLockPool,
  resetCronJobLockPool,
} from '../src/scheduler/cron-job-lock-pool.js';

describe('cron job advisory lock (e2e)', () => {
  let pool: Pool;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for cron advisory lock e2e tests');
    }
    pool = new Pool({ connectionString, max: 2 });
    getCronJobLockPool();
  });

  afterAll(async () => {
    await resetCronJobLockPool();
    await pool.end();
  });

  it('runs only one parallel sweep and releases the lock for the next tick', async () => {
    const jobName = `e2e-cron-lock-${Date.now()}`;
    const [key1, key2] = cronJobAdvisoryLockKeys(jobName);
    let effect = 0;
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const firstRun = withCronJobLock(jobName, async () => {
      effect += 1;
      await hold;
    });

    const lockPool = getCronJobLockPool();
    const challenger = await lockPool.connect();
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const result = await challenger.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
          [key1, key2],
        );
        if (result.rows[0]?.acquired === false) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      challenger.release();
    }

    releaseHold();
    const ranFirst = await firstRun;
    expect(ranFirst).toBe(true);
    expect(effect).toBe(1);

    const ranAfterRelease = await withCronJobLock(jobName, async () => {
      effect += 1;
    });
    expect(ranAfterRelease).toBe(true);
    expect(effect).toBe(2);
  });
});
