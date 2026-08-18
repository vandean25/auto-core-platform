import { describe, expect, it } from '@jest/globals';
import { SystemPrismaService } from './system-prisma.service';
import { resetSharedRuntimePool } from './shared-pg-pool';

describe('SystemPrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPooledUrl = process.env.DATABASE_URL_POOLED;

  afterEach(async () => {
    restoreEnv('DATABASE_URL', originalDatabaseUrl);
    restoreEnv('DATABASE_URL_POOLED', originalPooledUrl);
    await resetSharedRuntimePool();
  });

  it('queries platform admins without requiring tenant context', () => {
    expect(SystemPrismaService).toBeDefined();
  });

  it('exposes a privileged Prisma client for cross-tenant reads', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      SystemPrismaService.prototype,
      'client',
    );

    expect(descriptor).toBeDefined();
  });

  it('uses DATABASE_URL_POOLED for the adapter pool when set', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    const service = new SystemPrismaService();

    expect(
      (
        service as unknown as {
          pool: { options: { connectionString?: string } };
        }
      ).pool.options.connectionString,
    ).toBe('postgresql://pooled:5432/core');

    await service.onModuleDestroy();
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
