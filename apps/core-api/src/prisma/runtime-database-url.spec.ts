import { resolveRuntimeDatabaseUrl } from './runtime-database-url';

describe('resolveRuntimeDatabaseUrl', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPooledUrl = process.env.DATABASE_URL_POOLED;

  afterEach(() => {
    restoreEnv('DATABASE_URL', originalDatabaseUrl);
    restoreEnv('DATABASE_URL_POOLED', originalPooledUrl);
  });

  it('prefers DATABASE_URL_POOLED when it is set', () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    expect(resolveRuntimeDatabaseUrl()).toBe('postgresql://pooled:5432/core');
  });

  it('falls back to DATABASE_URL when DATABASE_URL_POOLED is unset', () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    delete process.env.DATABASE_URL_POOLED;

    expect(resolveRuntimeDatabaseUrl()).toBe('postgresql://direct:5432/core');
  });

  it('falls back to DATABASE_URL when DATABASE_URL_POOLED is blank', () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = '   ';

    expect(resolveRuntimeDatabaseUrl()).toBe('postgresql://direct:5432/core');
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
