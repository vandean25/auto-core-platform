import { Test, TestingModule } from '@nestjs/testing';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from './prisma.service.js';
import { PrismaModule } from './prisma.module.js';
import { SystemPrismaService } from './system-prisma.service.js';
import { resetSharedRuntimePool } from './shared-pg-pool.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { PrismaTransactionContext } from './prisma-transaction-context.js';

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

  it('routes model delegate calls to DryRunStorage transaction client when active', async () => {
    service = await createPrismaService();
    const mockTxCustomer = {
      create: jest.fn().mockResolvedValue({ id: 'mock-1' }),
    };
    const mockTx = { customer: mockTxCustomer };

    await DryRunStorage.run({ isDryRun: true, tx: mockTx as any }, async () => {
      const customerDelegate = (service as any).customer;
      expect(customerDelegate).toBe(mockTxCustomer);
    });
  });

  it('routes calls to transaction client when transaction client is a Proxy without has trap', async () => {
    service = await createPrismaService();
    const mockTxCustomer = {
      create: jest.fn().mockResolvedValue({ id: 'proxy-1' }),
    };
    const rawTarget = {};
    const mockTxProxy = new Proxy(rawTarget, {
      get(t, prop) {
        if (prop === 'customer') return mockTxCustomer;
        return undefined;
      },
    });

    await DryRunStorage.run(
      { isDryRun: true, tx: mockTxProxy as any },
      async () => {
        const customerDelegate = (service as any).customer;
        expect(customerDelegate).toBe(mockTxCustomer);
      },
    );
  });

  it('preserves PrismaTransactionContext while resolving a thenable returned by an interactive transaction callback', async () => {
    service = await createPrismaService();
    const mockTx = { isTx: true };
    jest
      .spyOn(service.client as any, '$transaction')
      .mockImplementation(async (callback: any) => callback(mockTx));

    let contextInsideThenable: unknown;
    await service.$transaction((() => ({
      then(resolve: (value: unknown) => void) {
        contextInsideThenable = PrismaTransactionContext.getClient();
        resolve({ ok: true });
      },
    })) as any);

    expect(contextInsideThenable).toBe(mockTx);
  });

  it('buffers realtime emits inside $transaction and flushes them only after commit', async () => {
    const emitEntityUpdated = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    })
      .overrideProvider(DashboardRealtimeService)
      .useValue({ emitEntityUpdated })
      .compile();
    service = module.get(PrismaService);

    let resolveCommit: () => void = () => undefined;
    jest
      .spyOn(service.client as any, '$transaction')
      .mockImplementation(async (callback: any) => {
        const result = await callback({ isTx: true });
        await new Promise<void>((resolve) => {
          resolveCommit = resolve;
        });
        return result;
      });

    const { emitRealtimeForOperation } = await import(
      './prisma-dashboard-realtime.extension.js'
    );
    const { TenantContextStorage } = await import(
      '../common/services/tenant-context.storage.js'
    );

    let callbackFinished = false;
    const txPromise = TenantContextStorage.run(() => {
      TenantContextStorage.setUser({
        userId: 'user-1',
        email: 'user@example.com',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      });
      return service.$transaction(async () => {
        emitRealtimeForOperation({ emitEntityUpdated }, 'Customer', 'create', {
          id: 'cust-1',
        });
        expect(emitEntityUpdated).not.toHaveBeenCalled();
        callbackFinished = true;
      });
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(callbackFinished).toBe(true);
    expect(emitEntityUpdated).not.toHaveBeenCalled();

    resolveCommit();
    await txPromise;
    expect(emitEntityUpdated).toHaveBeenCalledTimes(1);
    expect(emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
      type: 'CUSTOMER',
      action: 'CREATED',
      entityId: 'cust-1',
    });
  });

  it('drops buffered realtime emits when $transaction rolls back', async () => {
    const emitEntityUpdated = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    })
      .overrideProvider(DashboardRealtimeService)
      .useValue({ emitEntityUpdated })
      .compile();
    service = module.get(PrismaService);

    jest
      .spyOn(service.client as any, '$transaction')
      .mockImplementation(async (callback: any) => callback({ isTx: true }));

    const { emitRealtimeForOperation } = await import(
      './prisma-dashboard-realtime.extension.js'
    );
    const { TenantContextStorage } = await import(
      '../common/services/tenant-context.storage.js'
    );

    await expect(
      TenantContextStorage.run(() => {
        TenantContextStorage.setUser({
          userId: 'user-1',
          email: 'user@example.com',
          tenantId: 'tenant-1',
          role: 'ADMIN',
        });
        return service.$transaction(async () => {
          emitRealtimeForOperation({ emitEntityUpdated }, 'Customer', 'create', {
            id: 'cust-1',
          });
          throw new Error('rollback');
        });
      }),
    ).rejects.toThrow('rollback');

    expect(emitEntityUpdated).not.toHaveBeenCalled();
  });
});

async function createPrismaService(): Promise<PrismaService> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [PrismaModule],
  })
    .overrideProvider(DashboardRealtimeService)
    .useValue({ emitEntityUpdated: jest.fn() })
    .compile();

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
