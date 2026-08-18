import { Test, TestingModule } from '@nestjs/testing';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { PrismaService } from './prisma.service';
import { SystemPrismaService } from './system-prisma.service';
import { resetSharedRuntimePool } from './shared-pg-pool';

describe('PrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPooledUrl = process.env.DATABASE_URL_POOLED;
  let service: PrismaService;

  afterEach(async () => {
    restoreEnv('DATABASE_URL', originalDatabaseUrl);
    restoreEnv('DATABASE_URL_POOLED', originalPooledUrl);

    if (service) {
      await service.onModuleDestroy();
    }

    await resetSharedRuntimePool();
  });

  it('should be defined', async () => {
    service = await createPrismaService();

    expect(service).toBeDefined();
  });

  it('uses DATABASE_URL_POOLED for the adapter pool when set', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    service = await createPrismaService();

    expect(runtimePool(service).options.connectionString).toBe(
      'postgresql://pooled:5432/core',
    );
  });

  it('falls back to DATABASE_URL when DATABASE_URL_POOLED is unset', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    delete process.env.DATABASE_URL_POOLED;

    service = await createPrismaService();

    expect(runtimePool(service).options.connectionString).toBe(
      'postgresql://direct:5432/core',
    );
  });

  it('shares one pg Pool with SystemPrismaService', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    service = await createPrismaService();
    const systemPrisma = new SystemPrismaService();

    expect(runtimePool(service)).toBe(runtimePool(systemPrisma));

    await systemPrisma.onModuleDestroy();
  });
});

async function createPrismaService(): Promise<PrismaService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PrismaService,
      {
        provide: DashboardRealtimeService,
        useValue: {
          emitEntityUpdated: jest.fn(),
        },
      },
    ],
  }).compile();

  return module.get(PrismaService);
}

function runtimePool(client: PrismaService | SystemPrismaService) {
  return (
    client as unknown as { pool: { options: { connectionString?: string } } }
  ).pool;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
