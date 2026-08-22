import { describe, expect, it } from '@jest/globals';
import {
  SYSTEM_PRISMA_OMITS_TENANT_MODELS,
  SystemPrismaService,
} from './system-prisma.service';
import {
  createSystemPrismaTransactionClient,
  SYSTEM_PRISMA_MODEL_DELEGATES,
} from './system-prisma.types';
import { resetSharedRuntimePool } from './shared-pg-pool';

const TENANT_MODEL_DELEGATES = [
  'customer',
  'vehicle',
  'employee',
  'workshopOrder',
  'workshopSettings',
  'invoice',
  'salesOrder',
  'catalogItem',
  'inventoryStock',
] as const;

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
    expect(SYSTEM_PRISMA_OMITS_TENANT_MODELS).toBe(true);
  });

  it('exposes allowlisted global, membership, scheduler, and bootstrap delegates', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    const service = new SystemPrismaService();

    for (const delegate of SYSTEM_PRISMA_MODEL_DELEGATES) {
      expect(delegate in service).toBe(true);
      expect(
        (service as unknown as Record<string, unknown>)[delegate],
      ).toBeDefined();
    }

    await service.onModuleDestroy();
  });

  it('does not expose tenant-scoped model delegates', async () => {
    process.env.DATABASE_URL = 'postgresql://direct:5432/core';
    process.env.DATABASE_URL_POOLED = 'postgresql://pooled:5432/core';

    const service = new SystemPrismaService();

    for (const delegate of TENANT_MODEL_DELEGATES) {
      expect(delegate in service).toBe(false);
      expect(
        (service as unknown as Record<string, unknown>)[delegate],
      ).toBeUndefined();
    }

    await service.onModuleDestroy();
  });

  it('does not expose a full Prisma client escape hatch', () => {
    expect(
      Object.getOwnPropertyDescriptor(SystemPrismaService.prototype, 'client'),
    ).toBeUndefined();
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

describe('createSystemPrismaTransactionClient', () => {
  const fakeClient = {
    user: { findFirst: jest.fn() },
    tenant: { findMany: jest.fn() },
    tenantMember: { findMany: jest.fn() },
    platformAdmin: { findFirst: jest.fn() },
    laborEntry: { findMany: jest.fn() },
    financeSettings: { create: jest.fn() },
    customer: { findMany: jest.fn() },
    vehicle: { findMany: jest.fn() },
  };

  it('forwards allowlisted delegates', () => {
    const tx = createSystemPrismaTransactionClient(fakeClient as never);

    expect(tx.user).toBe(fakeClient.user);
    expect(tx.tenant).toBe(fakeClient.tenant);
    expect(tx.laborEntry).toBe(fakeClient.laborEntry);
    expect(tx.financeSettings).toBe(fakeClient.financeSettings);
  });

  it('rejects tenant-scoped delegates on the transaction client', () => {
    const tx = createSystemPrismaTransactionClient(fakeClient as never);

    expect('customer' in tx).toBe(false);
    expect((tx as { customer?: unknown }).customer).toBeUndefined();
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
