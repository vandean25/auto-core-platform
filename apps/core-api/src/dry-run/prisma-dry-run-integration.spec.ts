import { jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  applyAuditUpdate,
  applyAuditDelete,
  applyAuditUpdateMany,
  applyAuditDeleteMany,
  createAuditExtension,
} from '../prisma/prisma-audit.extension.js';
import {
  emitRealtimeForOperation,
  createDashboardRealtimeExtension,
} from '../prisma/prisma-dashboard-realtime.extension.js';
import { DryRunStorage } from './dry-run.storage.js';
import { DryRunChangeCollector } from './dry-run-change-collector.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { releaseSharedRuntimePool } from '../prisma/shared-pg-pool.js';
import type { Prisma } from '@prisma/client';
import type { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';

const TENANT_ID = 'test-tenant-dry-run';

function runWithTenantContext<T>(fn: () => T): T {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: 'user-dry-run-1',
      email: 'pilot-mechanic@example.com',
      tenantId: TENANT_ID,
      role: 'ADMIN',
    });
    TenantContextStorage.setRequestMeta({
      requestId: 'req-dry-run-1',
      source: 'API',
    });
    return fn();
  });
}

describe('Prisma Dry-Run Integration', () => {
  let mockDashboardRealtime: jest.Mocked<
    Pick<DashboardRealtimeService, 'emitEntityUpdated'>
  >;
  let prismaService: PrismaService;

  beforeEach(() => {
    mockDashboardRealtime = {
      emitEntityUpdated: jest.fn(),
    };
    prismaService = new PrismaService(
      mockDashboardRealtime as unknown as DashboardRealtimeService,
    );
  });

  afterAll(async () => {
    await releaseSharedRuntimePool();
  });

  describe('PrismaService Proxy Transaction Routing', () => {
    it('transparently routes model calls to tx when DryRunStorage has an active transaction client', async () => {
      const mockFindMany = jest
        .fn()
        .mockResolvedValue([{ id: 'cust-1', name: 'Customer 1' }]);
      const mockTx = {
        customer: {
          findMany: mockFindMany,
        },
        workshopOrder: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'wo-1', number: 'WO-001' }),
        },
      } as unknown as Prisma.TransactionClient;

      await DryRunStorage.run({ isDryRun: true, tx: mockTx }, async () => {
        // Accessing customer.findMany via prismaService should route to mockTx.customer.findMany
        const customers = await (prismaService as any).customer.findMany({
          where: { tenant_id: TENANT_ID },
        });

        expect(mockFindMany).toHaveBeenCalledWith({
          where: { tenant_id: TENANT_ID },
        });
        expect(customers).toEqual([{ id: 'cust-1', name: 'Customer 1' }]);
      });
    });

    it('passes tx into $transaction callback when already inside a dry-run transaction', async () => {
      const mockTx = {
        customer: {
          update: jest.fn().mockResolvedValue({ id: 'cust-1' }),
        },
      } as unknown as Prisma.TransactionClient;

      await DryRunStorage.run({ isDryRun: true, tx: mockTx }, async () => {
        const result = await prismaService.$transaction(async (currentTx) => {
          expect(currentTx).toBe(mockTx);
          return 'transaction-result';
        });

        expect(result).toBe('transaction-result');
      });
    });

    it('routes to base client when DryRunStorage transaction client is not active', () => {
      // Outside DryRunStorage, accessing model delegate should not route to mockTx
      const customerDelegate = (prismaService as any).customer;
      expect(customerDelegate).toBeDefined();
      expect(customerDelegate).toBe((prismaService as any).client.customer);
    });
  });

  describe('Audit Suppression and Change Collection (prisma-audit.extension)', () => {
    let collector: DryRunChangeCollector;
    let mockAuditLogCreate: jest.Mock;
    let mockModelFindFirst: jest.Mock;
    let mockContext: Record<string, unknown>;

    beforeEach(() => {
      collector = new DryRunChangeCollector();
      mockAuditLogCreate = jest.fn().mockResolvedValue({ id: 'audit-log-1' });
      mockModelFindFirst = jest.fn();
      mockContext = {
        auditLog: {
          create: mockAuditLogCreate,
        },
        customer: {
          findFirst: mockModelFindFirst,
          findMany: jest.fn(),
        },
      };
    });

    it('suppresses audit log creation and records update in collector during dry run', async () => {
      const beforeRow = { id: 'cust-1', name: 'Old Name' };
      const afterRow = { id: 'cust-1', name: 'New Name' };
      mockModelFindFirst.mockResolvedValue(beforeRow);
      const queryFn = jest.fn().mockResolvedValue(afterRow);

      await runWithTenantContext(async () => {
        await DryRunStorage.run(
          { isDryRun: true, collector },
          async () => {
            const result = await applyAuditUpdate.call(
              mockContext,
              mockContext,
              'Customer',
              { where: { id: 'cust-1' }, data: { name: 'New Name' } },
              queryFn,
            );

            expect(result).toEqual(afterRow);
          },
        );
      });

      // AuditLog.create must NOT be called
      expect(mockAuditLogCreate).not.toHaveBeenCalled();

      // Change collector must have recorded the update
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-1', op: 'update' },
      ]);
    });

    it('suppresses audit log creation and records delete in collector during dry run', async () => {
      const beforeRow = { id: 'cust-2', name: 'Deleted Customer' };
      mockModelFindFirst.mockResolvedValue(beforeRow);
      const queryFn = jest.fn().mockResolvedValue(beforeRow);

      await runWithTenantContext(async () => {
        await DryRunStorage.run(
          { isDryRun: true, collector },
          async () => {
            const result = await applyAuditDelete.call(
              mockContext,
              mockContext,
              'Customer',
              { where: { id: 'cust-2' } },
              queryFn,
            );

            expect(result).toEqual(beforeRow);
          },
        );
      });

      expect(mockAuditLogCreate).not.toHaveBeenCalled();
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-2', op: 'delete' },
      ]);
    });

    it('suppresses audit log creation and records batch updates in collector during dry run', async () => {
      const beforeRows = [
        { id: 'cust-1', name: 'A' },
        { id: 'cust-2', name: 'B' },
      ];
      (mockContext.customer as any).findMany.mockImplementation(
        ({ where }: any) => {
          if (where?.id?.in) {
            return Promise.resolve([
              { id: 'cust-1', name: 'A-updated' },
              { id: 'cust-2', name: 'B-updated' },
            ]);
          }
          return Promise.resolve(beforeRows);
        },
      );
      const queryFn = jest.fn().mockResolvedValue({ count: 2 });

      await runWithTenantContext(async () => {
        await DryRunStorage.run(
          { isDryRun: true, collector },
          async () => {
            await applyAuditUpdateMany.call(
              mockContext,
              mockContext,
              'Customer',
              { where: { tenant_id: TENANT_ID }, data: { name: 'updated' } },
              queryFn,
            );
          },
        );
      });

      expect(mockAuditLogCreate).not.toHaveBeenCalled();
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-1', op: 'update' },
        { entity: 'Customer', id: 'cust-2', op: 'update' },
      ]);
    });

    it('suppresses audit log creation and records batch deletes in collector during dry run', async () => {
      const beforeRows = [
        { id: 'cust-3', name: 'C' },
        { id: 'cust-4', name: 'D' },
      ];
      (mockContext.customer as any).findMany.mockResolvedValue(beforeRows);
      const queryFn = jest.fn().mockResolvedValue({ count: 2 });

      await runWithTenantContext(async () => {
        await DryRunStorage.run(
          { isDryRun: true, collector },
          async () => {
            await applyAuditDeleteMany.call(
              mockContext,
              mockContext,
              'Customer',
              { where: { tenant_id: TENANT_ID } },
              queryFn,
            );
          },
        );
      });

      expect(mockAuditLogCreate).not.toHaveBeenCalled();
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-3', op: 'delete' },
        { entity: 'Customer', id: 'cust-4', op: 'delete' },
      ]);
    });
  });

  describe('Realtime WebSocket Suppression and Change Collection (prisma-dashboard-realtime.extension)', () => {
    let collector: DryRunChangeCollector;

    beforeEach(() => {
      collector = new DryRunChangeCollector();
    });

    it('suppresses realtime emission and records create in collector during dry run', () => {
      runWithTenantContext(() => {
        DryRunStorage.run(
          { isDryRun: true, collector },
          () => {
            emitRealtimeForOperation(
              mockDashboardRealtime,
              'WorkshopOrder',
              'create',
              { id: 'wo-100', status: 'DRAFT' },
            );
          },
        );
      });

      // WebSocket event must NOT be emitted
      expect(mockDashboardRealtime.emitEntityUpdated).not.toHaveBeenCalled();

      // Collector must record 'create'
      expect(collector.getChanges()).toEqual([
        { entity: 'WorkshopOrder', id: 'wo-100', op: 'create' },
      ]);
    });

    it('suppresses realtime emission and records update in collector during dry run', () => {
      runWithTenantContext(() => {
        DryRunStorage.run(
          { isDryRun: true, collector },
          () => {
            emitRealtimeForOperation(
              mockDashboardRealtime,
              'Customer',
              'update',
              { id: 'cust-10', name: 'Updated' },
            );
          },
        );
      });

      expect(mockDashboardRealtime.emitEntityUpdated).not.toHaveBeenCalled();
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-10', op: 'update' },
      ]);
    });

    it('suppresses realtime emission and records delete in collector during dry run', () => {
      runWithTenantContext(() => {
        DryRunStorage.run(
          { isDryRun: true, collector },
          () => {
            emitRealtimeForOperation(
              mockDashboardRealtime,
              'Customer',
              'delete',
              { id: 'cust-10' },
            );
          },
        );
      });

      expect(mockDashboardRealtime.emitEntityUpdated).not.toHaveBeenCalled();
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-10', op: 'delete' },
      ]);
    });

    it('suppresses realtime emission and records upsert as create when newly inserted', () => {
      runWithTenantContext(() => {
        DryRunStorage.run(
          { isDryRun: true, collector },
          () => {
            emitRealtimeForOperation(
              mockDashboardRealtime,
              'Customer',
              'upsert',
              { id: 'cust-new' },
              'CREATED',
            );
          },
        );
      });

      expect(mockDashboardRealtime.emitEntityUpdated).not.toHaveBeenCalled();
      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-new', op: 'create' },
      ]);
    });

    it('emits realtime event when NOT in dry run', () => {
      runWithTenantContext(() => {
        emitRealtimeForOperation(
          mockDashboardRealtime,
          'WorkshopOrder',
          'create',
          { id: 'wo-200' },
        );
      });

      expect(mockDashboardRealtime.emitEntityUpdated).toHaveBeenCalledWith(
        TENANT_ID,
        {
          type: 'WORKSHOP_ORDER',
          action: 'CREATED',
          entityId: 'wo-200',
        },
      );
    });
  });
});
