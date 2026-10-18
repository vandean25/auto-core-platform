import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { cronJobAdvisoryLockKeys } from './cron-job-advisory-lock-key.js';
import {
  releaseCronJobAdvisoryLock,
  tryAcquireCronJobAdvisoryLock,
  withCronJobLock,
} from './cron-job-advisory-lock.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/auto_core_test';

function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

describe('cronJobAdvisoryLockKeys', () => {
  it('is stable for a given job name', () => {
    expect(cronJobAdvisoryLockKeys('notification-outbox-recovery')).toEqual(
      cronJobAdvisoryLockKeys('notification-outbox-recovery'),
    );
    expect(cronJobAdvisoryLockKeys('hr-shift-close')).not.toEqual(
      cronJobAdvisoryLockKeys('mechanic-shift-close'),
    );
  });
});

describe('withCronJobLock (database)', () => {
  let poolA: Pool;
  let poolB: Pool;
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  let databaseReady = false;

  beforeAll(async () => {
    poolA = new Pool({ connectionString: databaseUrl });
    poolB = new Pool({ connectionString: databaseUrl });
    clientA = createPrismaClient(poolA);
    clientB = createPrismaClient(poolB);
    try {
      await clientA.$connect();
      await clientB.$connect();
      await clientA.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      databaseReady = false;
    }
  });

  afterAll(async () => {
    await clientA?.$disconnect();
    await clientB?.$disconnect();
    await poolA?.end();
    await poolB?.end();
  });

  it('allows only one parallel holder per job name', async () => {
    if (!databaseReady) {
      console.warn('Skipping advisory lock parallel test: Postgres unavailable');
      return;
    }

    const jobName = `aut-611-parallel-test-${Date.now()}`;
    let concurrent = 0;
    let maxConcurrent = 0;
    let executions = 0;

    const hold = async (client: PrismaClient) => {
      const acquired = await tryAcquireCronJobAdvisoryLock(client, jobName);
      if (!acquired) {
        return false;
      }
      try {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        executions += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
        concurrent -= 1;
        return true;
      } finally {
        await releaseCronJobAdvisoryLock(client, jobName);
      }
    };

    const [ranA, ranB] = await Promise.all([
      hold(clientA),
      hold(clientB),
    ]);

    expect(executions).toBe(1);
    expect(maxConcurrent).toBe(1);
    expect([ranA, ranB].filter(Boolean)).toHaveLength(1);
  });

  it('runs the callback when the lock is free', async () => {
    if (!databaseReady) {
      console.warn('Skipping advisory lock callback test: Postgres unavailable');
      return;
    }

    let effect = 0;
    const ran = await withCronJobLock(
      clientA,
      `aut-611-callback-${Date.now()}`,
      async () => {
        effect += 1;
      },
    );

    expect(ran).toBe(true);
    expect(effect).toBe(1);
  });
});
