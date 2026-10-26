import { jest } from '@jest/globals';

const poolConstructor = jest.fn();

jest.unstable_mockModule('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      poolConstructor(options);
    }
    on() {
      return this;
    }
    end() {
      return Promise.resolve();
    }
  },
}));

jest.unstable_mockModule('../prisma/runtime-database-url.js', () => ({
  resolveDirectDatabaseUrl: () => 'postgresql://direct.example/db',
}));

const { getCronJobLockPool, resetCronJobLockPool } =
  await import('./cron-job-lock-pool.js');

describe('cron job lock pool', () => {
  afterEach(async () => {
    await resetCronJobLockPool();
    poolConstructor.mockClear();
  });

  it('sizes the pool for every-minute cron bursts', () => {
    getCronJobLockPool();

    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 10,
        connectionTimeoutMillis: 30_000,
        idleTimeoutMillis: 90_000,
      }),
    );
  });
});
