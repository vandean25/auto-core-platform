import { Pool } from 'pg';
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
    let effect = 0;

    const [ranA, ranB] = await Promise.all([
      withCronJobLock(jobName, async () => {
        effect += 1;
        await pool.query('SELECT pg_sleep(0.25)');
        await pool.query('SELECT 1');
      }),
      withCronJobLock(jobName, async () => {
        effect += 1;
        await pool.query('SELECT pg_sleep(0.25)');
      }),
    ]);

    expect(effect).toBe(1);
    expect([ranA, ranB].filter(Boolean)).toHaveLength(1);

    const ranAfterRelease = await withCronJobLock(jobName, async () => {
      effect += 1;
    });
    expect(ranAfterRelease).toBe(true);
    expect(effect).toBe(2);
  });
});
