import { Pool } from 'pg';
import {
  getSharedRuntimePool,
  releaseSharedRuntimePool,
  resetSharedRuntimePool,
} from './shared-pg-pool';

describe('getSharedRuntimePool', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPooledUrl = process.env.DATABASE_URL_POOLED;

  afterEach(async () => {
    restoreEnv('DATABASE_URL', originalDatabaseUrl);
    restoreEnv('DATABASE_URL_POOLED', originalPooledUrl);
    await resetSharedRuntimePool();
  });

  it('returns the same Pool instance for repeated runtime clients', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    const first = getSharedRuntimePool();
    const second = getSharedRuntimePool();

    expect(first).toBe(second);
    expect(first).toBeInstanceOf(Pool);
  });

  it('opens the pool against DATABASE_URL_POOLED when set', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    const pool = getSharedRuntimePool();

    expect(pool.options.connectionString).toBe('postgresql://pooled:5432/core');
  });

  it('ends the pool only after every owner releases it', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';

    const first = getSharedRuntimePool();
    getSharedRuntimePool();

    const end = jest.spyOn(first, 'end');

    await releaseSharedRuntimePool();
    expect(end).not.toHaveBeenCalled();

    await releaseSharedRuntimePool();
    expect(end).toHaveBeenCalledTimes(1);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
