import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_PRISMA_OPERATIONS,
  OPERATION_CLASSIFICATIONS,
  applyTenantIsolation,
} from './tenant-isolation.extension.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { PrismaTransactionContext } from './prisma-transaction-context.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';

const TENANT_ID = 'tenant-test-123';

function runWithTenant<T>(fn: () => T) {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: 'user-1',
      email: 'test@example.com',
      tenantId: TENANT_ID,
      role: 'ADMIN',
    });
    return fn();
  });
}

function call(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  queryFn: jest.Mock,
  baseClient: Record<string, unknown> = {},
) {
  return applyTenantIsolation.call(
    {},
    baseClient,
    model,
    operation,
    args,
    queryFn,
  );
}

function createBaseClient(model: string) {
  return {
    [model.charAt(0).toLowerCase() + model.slice(1)]: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

function createTransactionClient() {
  return {} as unknown as Prisma.TransactionClient;
}

function recordNotFoundError() {
  return Object.assign(new Error('Record to update not found.'), {
    code: 'P2025',
  });
}

describe('applyTenantIsolation', () => {
  it('does not use any in Prisma tenant or audit extensions', () => {
    const extensionFiles = [
      'tenant-isolation.extension.ts',
      'prisma-audit.extension.ts',
    ];

    for (const extensionFile of extensionFiles) {
      const source = readFileSync(
        join(import.meta.dirname, extensionFile),
        'utf8',
      );

      expect(source).not.toMatch(/\bany\b/);
    }
  });

  describe('GLOBAL_MODELS', () => {
    it('passes through Tenant queries without injecting tenant_id', async () => {
      const query = jest.fn().mockResolvedValue([]);
      const args = { where: { slug: 'acme' } };

      await runWithTenant(() => call('Tenant', 'findMany', args, query));

      expect(query).toHaveBeenCalledWith(args);
      expect(query.mock.calls[0][0]).not.toHaveProperty('where.tenant_id');
    });

    it('passes through MasterPart queries without injecting tenant_id', async () => {
      const query = jest.fn().mockResolvedValue([]);
      const args = {
        where: {
          supplier_part_number: {
            contains: 'test',
            mode: 'insensitive',
          },
        },
      };

      await runWithTenant(() => call('MasterPart', 'findMany', args, query));

      expect(query).toHaveBeenCalledWith(args);
      expect(query.mock.calls[0][0]).not.toHaveProperty('where.tenant_id');
    });
  });

  describe('tenant-scoped workshop settings models', () => {
    it('injects tenant_id into Bay findMany queries', async () => {
      const query = jest.fn().mockResolvedValue([]);

      await runWithTenant(() => call('Bay', 'findMany', { where: {} }, query));

      expect(query).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });

    it('injects tenant_id into Employee create payloads', async () => {
      const query = jest.fn().mockResolvedValue({});

      await runWithTenant(() =>
        call(
          'Employee',
          'create',
          {
            data: {
              name: 'Jane Doe',
              role: 'MECHANIC',
              is_active: true,
            },
          },
          query,
        ),
      );

      expect(query).toHaveBeenCalledWith({
        data: {
          name: 'Jane Doe',
          role: 'MECHANIC',
          is_active: true,
          tenant_id: TENANT_ID,
        },
      });
    });

    it('initialises missing args before scoping a Bay query', async () => {
      const query = jest.fn().mockResolvedValue([]);

      await runWithTenant(() => call('Bay', 'findMany', undefined, query));

      expect(query).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });
  });

  describe('count() — must be scoped', () => {
    it('injects tenant_id into where for count()', async () => {
      const query = jest.fn().mockResolvedValue(5);
      const args = { where: {} };

      await runWithTenant(() => call('SalesOrder', 'count', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });
  });

  describe('findMany() — must be scoped', () => {
    it('injects tenant_id into where while preserving existing filters', async () => {
      const query = jest.fn().mockResolvedValue([]);
      const args = { where: { status: 'DRAFT' } };

      await runWithTenant(() => call('PurchaseOrder', 'findMany', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { status: 'DRAFT', tenant_id: TENANT_ID },
      });
    });
  });

  describe('findFirst() and findFirstOrThrow() — must be scoped', () => {
    it('injects tenant_id into where for findFirst', async () => {
      const query = jest.fn().mockResolvedValue({ id: '1' });
      const args = { where: { code: 'MAIN' } };

      await runWithTenant(() => call('Site', 'findFirst', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { code: 'MAIN', tenant_id: TENANT_ID },
      });
    });

    it('injects tenant_id into where for findFirstOrThrow', async () => {
      const query = jest.fn().mockResolvedValue({ id: '1' });
      const args = { where: { code: 'MAIN' } };

      await runWithTenant(() => call('Site', 'findFirstOrThrow', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { code: 'MAIN', tenant_id: TENANT_ID },
      });
    });
  });

  describe('bulk operations — must be scoped', () => {
    it('injects tenant_id into where for updateMany', async () => {
      const query = jest.fn().mockResolvedValue({ count: 2 });
      const args = {
        where: { status: 'DRAFT' },
        data: { status: 'CONFIRMED' },
      };

      await runWithTenant(() => call('SalesOrder', 'updateMany', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { status: 'DRAFT', tenant_id: TENANT_ID },
        data: { status: 'CONFIRMED' },
      });
    });

    it('injects tenant_id into where for updateManyAndReturn', async () => {
      const query = jest.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);
      const args = {
        where: { status: 'DRAFT' },
        data: { status: 'CONFIRMED' },
      };

      await runWithTenant(() =>
        call('SalesOrder', 'updateManyAndReturn', args, query),
      );

      expect(query).toHaveBeenCalledWith({
        where: { status: 'DRAFT', tenant_id: TENANT_ID },
        data: { status: 'CONFIRMED' },
      });
    });

    it('rejects updateMany when data contains tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: { status: 'DRAFT' },
        data: { status: 'CONFIRMED', tenant_id: 'some-tenant' },
      };

      await expect(
        runWithTenant(() => call('SalesOrder', 'updateMany', args, query)),
      ).rejects.toThrow(
        /\[TenantIsolation\] Modifying tenant_id in updateMany data on model 'SalesOrder' is not permitted\./,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects updateManyAndReturn when data contains tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: { status: 'DRAFT' },
        data: { status: 'CONFIRMED', tenant_id: 'some-tenant' },
      };

      await expect(
        runWithTenant(() =>
          call('SalesOrder', 'updateManyAndReturn', args, query),
        ),
      ).rejects.toThrow(
        /\[TenantIsolation\] Modifying tenant_id in updateManyAndReturn data on model 'SalesOrder' is not permitted\./,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('injects tenant_id into where for deleteMany', async () => {
      const query = jest.fn().mockResolvedValue({ count: 1 });
      const args = { where: { status: 'CANCELLED' } };

      await runWithTenant(() => call('SalesOrder', 'deleteMany', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { status: 'CANCELLED', tenant_id: TENANT_ID },
      });
    });
  });

  describe('aggregate and groupBy — must be scoped with options preserved', () => {
    it('preserves having and by while injecting tenant_id into where for groupBy', async () => {
      const query = jest.fn().mockResolvedValue([]);
      const args = {
        by: ['status'],
        where: { is_active: true },
        having: { status: { _count: { gt: 5 } } },
      };

      await runWithTenant(() => call('SalesOrder', 'groupBy', args, query));

      expect(query).toHaveBeenCalledWith({
        by: ['status'],
        where: { is_active: true, tenant_id: TENANT_ID },
        having: { status: { _count: { gt: 5 } } },
      });
    });

    it('preserves _count and _sum while injecting tenant_id into where for aggregate', async () => {
      const query = jest.fn().mockResolvedValue({ _count: { id: 3 } });
      const args = {
        where: { status: 'CONFIRMED' },
        _count: { id: true },
        _sum: { total_amount: true },
      };

      await runWithTenant(() => call('SalesOrder', 'aggregate', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { status: 'CONFIRMED', tenant_id: TENANT_ID },
        _count: { id: true },
        _sum: { total_amount: true },
      });
    });
  });

  describe('update() — tenant ownership is part of the write', () => {
    it('runs only the tenant-scoped write and never pre-checks ownership', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'task-1' });
      const baseClient = createBaseClient('WorkshopTask');

      await runWithTenant(() =>
        call(
          'WorkshopTask',
          'update',
          {
            where: { id: 'task-1' },
            data: { status: 'DONE' },
          },
          query,
          baseClient,
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({
        where: { id: 'task-1', tenant_id: TENANT_ID },
        data: { status: 'DONE' },
      });
      expect(baseClient.workshopTask.findFirst).not.toHaveBeenCalled();
      expect(baseClient.workshopTask.findUnique).not.toHaveBeenCalled();
    });

    it('keeps tenant-scoped unique updates on the fast path without a delegate', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'settings-1' });
      await runWithTenant(() =>
        applyTenantIsolation.call(
          {},
          {},
          'FinanceSettings',
          'update',
          {
            where: { tenant_id: 'wrong-tenant' },
            data: { workshop_order_prefix: 'WO-2026-' },
          },
          query,
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
        data: { workshop_order_prefix: 'WO-2026-' },
      });
    });

    it('maps P2025 to NotFoundException for an unscoped where', async () => {
      const query = jest.fn().mockRejectedValue(recordNotFoundError());

      await expect(
        runWithTenant(() =>
          call(
            'WorkshopTask',
            'update',
            { where: { id: 'task-1' }, data: { status: 'DONE' } },
            query,
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('issues no query on the base client while an interactive transaction is active', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'task-1' });
      const baseClient = createBaseClient('WorkshopTask');
      const tx = createTransactionClient();

      await runWithTenant(() =>
        PrismaTransactionContext.run(tx, () =>
          call(
            'WorkshopTask',
            'update',
            { where: { id: 'task-1' }, data: { status: 'DONE' } },
            query,
            baseClient,
          ),
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({
        where: { id: 'task-1', tenant_id: TENANT_ID },
        data: { status: 'DONE' },
      });
      expect(baseClient.workshopTask.findFirst).not.toHaveBeenCalled();
    });

    it('rejects update when data contains tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: { id: 'task-1' },
        data: { status: 'DONE', tenant_id: 'some-tenant' },
      };

      await expect(
        runWithTenant(() => call('WorkshopTask', 'update', args, query)),
      ).rejects.toThrow(
        /\[TenantIsolation\] Modifying tenant_id in update data on model 'WorkshopTask' is not permitted\./,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('issues no query on the base client while a dry-run transaction is active', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'task-1' });
      const baseClient = createBaseClient('WorkshopTask');
      const tx = createTransactionClient();

      await runWithTenant(() =>
        DryRunStorage.run({ isDryRun: true, tx }, () =>
          call(
            'WorkshopTask',
            'update',
            { where: { id: 'task-1' }, data: { status: 'DONE' } },
            query,
            baseClient,
          ),
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({
        where: { id: 'task-1', tenant_id: TENANT_ID },
        data: { status: 'DONE' },
      });
      expect(baseClient.workshopTask.findFirst).not.toHaveBeenCalled();
    });

    it('rejects update when data contains tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: { id: 'task-1' },
        data: { status: 'DONE', tenant_id: 'some-tenant' },
      };

      await expect(
        runWithTenant(() => call('WorkshopTask', 'update', args, query)),
      ).rejects.toThrow(
        /\[TenantIsolation\] Modifying tenant_id in update data on model 'WorkshopTask' is not permitted\./,
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('delete() — tenant ownership is part of the write', () => {
    it('runs only the tenant-scoped delete and never pre-checks ownership', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'task-1' });
      const baseClient = createBaseClient('WorkshopTask');

      await runWithTenant(() =>
        call(
          'WorkshopTask',
          'delete',
          { where: { id: 'task-1' } },
          query,
          baseClient,
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({
        where: { id: 'task-1', tenant_id: TENANT_ID },
      });
      expect(baseClient.workshopTask.findFirst).not.toHaveBeenCalled();
      expect(baseClient.workshopTask.findUnique).not.toHaveBeenCalled();
    });

    it('maps P2025 to NotFoundException for an unscoped where', async () => {
      const query = jest.fn().mockRejectedValue(recordNotFoundError());

      await expect(
        runWithTenant(() =>
          call('WorkshopTask', 'delete', { where: { id: 'task-1' } }, query),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('issues no query on the base client while an interactive transaction is active', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'task-1' });
      const baseClient = createBaseClient('WorkshopTask');
      const tx = createTransactionClient();

      await runWithTenant(() =>
        PrismaTransactionContext.run(tx, () =>
          call(
            'WorkshopTask',
            'delete',
            { where: { id: 'task-1' } },
            query,
            baseClient,
          ),
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({
        where: { id: 'task-1', tenant_id: TENANT_ID },
      });
      expect(baseClient.workshopTask.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('create() — must stamp tenant_id', () => {
    it('injects tenant_id into data', async () => {
      const query = jest
        .fn()
        .mockResolvedValue({ id: '1', tenant_id: TENANT_ID });
      const args = { data: { name: 'Test', status: 'DRAFT' } };

      await runWithTenant(() => call('SalesOrder', 'create', args, query));

      expect(query).toHaveBeenCalledWith({
        data: { name: 'Test', status: 'DRAFT', tenant_id: TENANT_ID },
      });
    });

    it('injects tenant_id into each createMany payload row', async () => {
      const query = jest.fn().mockResolvedValue({ count: 2 });
      const args = {
        data: [
          { order_number: 'SO-1', status: 'DRAFT' },
          { order_number: 'SO-2', status: 'CONFIRMED' },
        ],
      };

      await runWithTenant(() => call('SalesOrder', 'createMany', args, query));

      expect(query).toHaveBeenCalledWith({
        data: [
          { order_number: 'SO-1', status: 'DRAFT', tenant_id: TENANT_ID },
          { order_number: 'SO-2', status: 'CONFIRMED', tenant_id: TENANT_ID },
        ],
      });
    });

    it('injects tenant_id into each createManyAndReturn payload row', async () => {
      const query = jest.fn().mockResolvedValue([
        { id: '1', order_number: 'SO-1', tenant_id: TENANT_ID },
        { id: '2', order_number: 'SO-2', tenant_id: TENANT_ID },
      ]);
      const args = {
        data: [
          { order_number: 'SO-1', status: 'DRAFT' },
          { order_number: 'SO-2', status: 'CONFIRMED' },
        ],
      };

      await runWithTenant(() =>
        call('SalesOrder', 'createManyAndReturn', args, query),
      );

      expect(query).toHaveBeenCalledWith({
        data: [
          { order_number: 'SO-1', status: 'DRAFT', tenant_id: TENANT_ID },
          { order_number: 'SO-2', status: 'CONFIRMED', tenant_id: TENANT_ID },
        ],
      });
    });

    it('injects tenant_id into createManyAndReturn when data is a single object', async () => {
      const query = jest
        .fn()
        .mockResolvedValue([
          { id: '1', order_number: 'SO-1', tenant_id: TENANT_ID },
        ]);
      const args = {
        data: { order_number: 'SO-1', status: 'DRAFT' },
      };

      await runWithTenant(() =>
        call('SalesOrder', 'createManyAndReturn', args, query),
      );

      expect(query).toHaveBeenCalledWith({
        data: { order_number: 'SO-1', status: 'DRAFT', tenant_id: TENANT_ID },
      });
    });

    it('rejects create when data specifies a mismatching tenant_id', async () => {
      const query = jest.fn();
      const args = {
        data: {
          order_number: 'SO-1',
          status: 'DRAFT',
          tenant_id: 'attacker-tenant',
        },
      };

      let thrownError: Error | null = null;
      try {
        await runWithTenant(() => call('SalesOrder', 'create', args, query));
      } catch (err) {
        thrownError = err as Error;
      }
      expect(thrownError?.message).toBe(
        "[TenantIsolation] Mismatching tenant_id in create on model 'SalesOrder'.",
      );
      expect(thrownError?.message).not.toContain('attacker-tenant');
      expect(thrownError?.message).not.toContain(TENANT_ID);
      expect(query).not.toHaveBeenCalled();
    });

    it('allows create when data specifies a matching tenant_id', async () => {
      const query = jest.fn().mockResolvedValue({ id: '1' });
      const args = {
        data: {
          order_number: 'SO-1',
          status: 'DRAFT',
          tenant_id: TENANT_ID,
        },
      };

      await runWithTenant(() => call('SalesOrder', 'create', args, query));

      expect(query).toHaveBeenCalledWith({
        data: { order_number: 'SO-1', status: 'DRAFT', tenant_id: TENANT_ID },
      });
    });

    it('rejects createMany when any payload row specifies a mismatching tenant_id', async () => {
      const query = jest.fn();
      const args = {
        data: [
          { order_number: 'SO-1', tenant_id: TENANT_ID },
          { order_number: 'SO-2', tenant_id: 'attacker-tenant' },
        ],
      };

      await expect(
        runWithTenant(() => call('SalesOrder', 'createMany', args, query)),
      ).rejects.toThrow(
        /\[TenantIsolation\] Mismatching tenant_id in createMany on model 'SalesOrder'\./,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects createManyAndReturn when any payload row specifies a mismatching tenant_id', async () => {
      const query = jest.fn();
      const args = {
        data: [{ order_number: 'SO-1', tenant_id: 'attacker-tenant' }],
      };

      await expect(
        runWithTenant(() =>
          call('SalesOrder', 'createManyAndReturn', args, query),
        ),
      ).rejects.toThrow(
        /\[TenantIsolation\] Mismatching tenant_id in createManyAndReturn on model 'SalesOrder'\./,
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('upsert() — must stamp tenant_id in create and enforce tenant-scoped where', () => {
    it('injects tenant_id into composite unique where and create', async () => {
      const query = jest.fn().mockResolvedValue({});
      const args = {
        where: {
          tenant_id_code: {
            tenant_id: 'wrong-tenant',
            code: 'LOC-001',
          },
        },
        create: {
          code: 'LOC-001',
          name: 'Main Warehouse',
          type: 'warehouse',
        },
        update: { name: 'Main Warehouse' },
      };

      await runWithTenant(() => call('StorageLocation', 'upsert', args, query));

      expect(query).toHaveBeenCalledWith({
        where: {
          tenant_id_code: {
            tenant_id: TENANT_ID,
            code: 'LOC-001',
          },
        },
        create: {
          code: 'LOC-001',
          name: 'Main Warehouse',
          type: 'warehouse',
          tenant_id: TENANT_ID,
        },
        update: { name: 'Main Warehouse' },
      });
    });

    it('rejects upsert where the selector does not include tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: { id: 'loc-1' },
        create: {
          code: 'LOC-001',
          name: 'Main Warehouse',
          type: 'warehouse',
        },
        update: { name: 'Main Warehouse' },
      };

      await expect(
        runWithTenant(() => call('StorageLocation', 'upsert', args, query)),
      ).rejects.toThrow(
        /must use a tenant-scoped unique selector containing tenant_id/,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects upsert({ id }) before issuing any query inside a transaction', async () => {
      const query = jest.fn();
      const baseClient = createBaseClient('StorageLocation');
      const tx = createTransactionClient();

      await expect(
        runWithTenant(() =>
          PrismaTransactionContext.run(tx, () =>
            call(
              'StorageLocation',
              'upsert',
              {
                where: { id: 'loc-1' },
                create: { code: 'LOC-001', name: 'Main Warehouse' },
                update: { name: 'Main Warehouse' },
              },
              query,
              baseClient,
            ),
          ),
        ),
      ).rejects.toThrow(
        /must use a tenant-scoped unique selector containing tenant_id/,
      );
      expect(query).not.toHaveBeenCalled();
      expect(baseClient.storageLocation.findUnique).not.toHaveBeenCalled();
      expect(baseClient.storageLocation.findFirst).not.toHaveBeenCalled();
    });

    it('rejects upsert when update data specifies tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: {
          tenant_id_code: { tenant_id: TENANT_ID, code: 'LOC-001' },
        },
        create: {
          code: 'LOC-001',
          name: 'Main Warehouse',
        },
        update: {
          name: 'Main Warehouse',
          tenant_id: 'some-tenant',
        },
      };

      await expect(
        runWithTenant(() => call('StorageLocation', 'upsert', args, query)),
      ).rejects.toThrow(
        /\[TenantIsolation\] Modifying tenant_id in upsert update data on model 'StorageLocation' is not permitted\./,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects upsert when create data specifies mismatching tenant_id', async () => {
      const query = jest.fn();
      const args = {
        where: {
          tenant_id_code: { tenant_id: TENANT_ID, code: 'LOC-001' },
        },
        create: {
          code: 'LOC-001',
          name: 'Main Warehouse',
          tenant_id: 'attacker-tenant',
        },
        update: {
          name: 'Main Warehouse',
        },
      };

      await expect(
        runWithTenant(() => call('StorageLocation', 'upsert', args, query)),
      ).rejects.toThrow(
        /\[TenantIsolation\] Mismatching tenant_id in create on model 'StorageLocation'\./,
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('nested relation writes rejection (depth 1 and 2)', () => {
    describe('depth 1 writes targeting tenant-scoped models', () => {
      it.each([
        ['connect', { connect: { id: 'cust-1' } }],
        [
          'connectOrCreate',
          {
            connectOrCreate: { where: { id: 'c-1' }, create: { name: 'New' } },
          },
        ],
        ['create', { create: { first_name: 'John', last_name: 'Doe' } }],
        ['createMany', { createMany: { data: [{ first_name: 'John' }] } }],
        ['update', { update: { first_name: 'John' } }],
        [
          'updateMany',
          { updateMany: { where: {}, data: { first_name: 'J' } } },
        ],
        ['delete', { delete: true }],
        ['deleteMany', { deleteMany: {} }],
        ['set', { set: [{ id: 'cust-1' }] }],
        ['disconnect', { disconnect: true }],
      ])(
        'rejects %s on customer relation in WorkshopOrder create',
        async (op, mutation) => {
          const query = jest.fn();
          const args = {
            data: {
              order_number: 'WO-101',
              customer: mutation,
            },
          };

          await expect(
            runWithTenant(() => call('WorkshopOrder', 'create', args, query)),
          ).rejects.toThrow(
            /\[TenantIsolation\] Nested relation write on 'WorkshopOrder\.customer' targeting tenant-scoped model 'Customer' is not permitted\./,
          );
          expect(query).not.toHaveBeenCalled();
        },
      );

      it('permits allowlisted nested relation write on Vendor.supportedBrands in create and update', async () => {
        const query = jest.fn().mockImplementation((a) => Promise.resolve(a));
        const brandMockClient = {
          brand: {
            findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
          },
        };
        const argsCreate = {
          data: {
            name: 'Vendor A',
            email: 'v@a.com',
            account_number: 'VA1',
            supportedBrands: { connect: [{ id: 1 }] },
          },
        };

        await runWithTenant(() =>
          call('Vendor', 'create', argsCreate, query, brandMockClient),
        );
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              tenant_id: TENANT_ID,
              supportedBrands: { connect: [{ id: 1 }] },
            }),
          }),
        );

        query.mockClear();
        const argsUpdate = {
          where: { id: 'vend-1' },
          data: {
            supportedBrands: { set: [{ id: 1 }] },
          },
        };

        await runWithTenant(() =>
          call('Vendor', 'update', argsUpdate, query, brandMockClient),
        );
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              supportedBrands: { set: [{ id: 1 }] },
            }),
          }),
        );
      });

      it('rejects Vendor.supportedBrands connect when brand belongs to another tenant', async () => {
        const query = jest.fn();
        const brandMockClient = {
          brand: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        const args = {
          data: {
            name: 'Vendor A',
            email: 'v@a.com',
            account_number: 'VA1',
            supportedBrands: { connect: [{ id: 999 }] },
          },
        };

        await expect(
          runWithTenant(() =>
            call('Vendor', 'create', args, query, brandMockClient),
          ),
        ).rejects.toThrow(
          /\[TenantIsolation\] Nested relation write on 'Vendor\.supportedBrands' references brands not belonging to current tenant\./,
        );
        expect(query).not.toHaveBeenCalled();
      });

      it('rejects Vendor.supportedBrands set when a brand belongs to another tenant', async () => {
        const query = jest.fn();
        const brandMockClient = {
          brand: {
            findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
          },
        };
        const args = {
          where: { id: 'vend-1' },
          data: {
            supportedBrands: { set: [{ id: 1 }, { id: 2 }] },
          },
        };

        await expect(
          runWithTenant(() =>
            call('Vendor', 'update', args, query, brandMockClient),
          ),
        ).rejects.toThrow(
          /\[TenantIsolation\] Nested relation write on 'Vendor\.supportedBrands' references brands not belonging to current tenant\./,
        );
        expect(query).not.toHaveBeenCalled();
      });

      it.each([
        'create',
        'createMany',
        'update',
        'updateMany',
        'delete',
        'deleteMany',
      ])('rejects nested mutation %s on Vendor.supportedBrands', async (mutationKey) => {
        const query = jest.fn();
        const brandMockClient = {
          brand: {
            findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
          },
        };
        const payload =
          mutationKey === 'delete'
            ? true
            : mutationKey === 'deleteMany' || mutationKey === 'updateMany'
              ? {}
              : [{ name: 'New Brand' }];
        const args = {
          data: {
            name: 'Vendor A',
            email: 'v@a.com',
            account_number: 'VA1',
            supportedBrands: {
              [mutationKey]: payload,
            },
          },
        };

        await expect(
          runWithTenant(() =>
            call('Vendor', 'create', args, query, brandMockClient),
          ),
        ).rejects.toThrow(
          /\[TenantIsolation\] Nested relation write on 'Vendor\.supportedBrands' targeting tenant-scoped model 'Brand' is not permitted\./,
        );
        expect(query).not.toHaveBeenCalled();
      });

      it('rejects Vendor.supportedBrands when no query client is available to verify brands', async () => {
        const query = jest.fn();
        const args = {
          data: {
            name: 'Vendor A',
            email: 'v@a.com',
            account_number: 'VA1',
            supportedBrands: { connect: [{ id: 1 }] },
          },
        };

        await expect(
          runWithTenant(() => call('Vendor', 'create', args, query, {})),
        ).rejects.toThrow(
          /\[TenantIsolation\] Cannot verify tenant ownership for nested relation write on 'Vendor\.supportedBrands'\. No brand query client available\./,
        );
        expect(query).not.toHaveBeenCalled();
      });

      it('permits allowlisted aggregate root child relations in create and update', async () => {
        const query = jest.fn().mockImplementation((a) => Promise.resolve(a));
        const argsCreate = {
          data: {
            order_number: 'WO-TASK-1',
            status: 'OPEN',
            tasks: {
              create: [
                {
                  title: 'Brake inspection',
                  status: 'NOT_STARTED',
                },
              ],
            },
          },
        };

        await runWithTenant(() =>
          call('WorkshopOrder', 'create', argsCreate, query),
        );
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              tenant_id: TENANT_ID,
              order_number: 'WO-TASK-1',
            }),
          }),
        );

        query.mockClear();
        const argsUpdate = {
          where: { id: 'wo-1' },
          data: {
            tasks: {
              deleteMany: {},
              create: [{ title: 'Oil replacement' }],
            },
          },
        };

        await runWithTenant(() =>
          call('WorkshopOrder', 'update', argsUpdate, query),
        );
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              tasks: {
                deleteMany: {},
                create: [{ title: 'Oil replacement' }],
              },
            }),
          }),
        );
      });

      it('rejects nested relation write inside an allowlisted child relation', async () => {
        const query = jest.fn();
        const args = {
          data: {
            order_number: 'WO-TASK-ADVERSARIAL',
            tasks: {
              create: [
                {
                  title: 'Illegal task with connect',
                  mechanic: { connect: { id: 'other-emp' } },
                },
              ],
            },
          },
        };

        await expect(
          runWithTenant(() => call('WorkshopOrder', 'create', args, query)),
        ).rejects.toThrow(
          /\[TenantIsolation\] Nested relation write on 'WorkshopTask\.mechanic' targeting tenant-scoped model 'Employee' is not permitted\./,
        );
        expect(query).not.toHaveBeenCalled();
      });

      describe('single-FK tenant-scoped child relations', () => {
        it.each([
          ['PurchaseOrder', 'items', 'PurchaseOrderItem'],
          ['SalesOrder', 'items', 'SalesOrderItem'],
          ['Invoice', 'items', 'InvoiceItem'],
          ['CreditNote', 'items', 'CreditNoteItem'],
          ['PurchaseInvoice', 'lines', 'PurchaseInvoiceLine'],
          ['PartsRequisition', 'lines', 'PartsRequisitionLine'],
        ])(
          'stamps context tenant_id on nested create for %s.%s',
          async (parentModel, relField) => {
            const query = jest
              .fn()
              .mockImplementation((a) => Promise.resolve(a));
            const args = {
              data: {
                parent_code: 'TEST-1',
                [relField]: {
                  create: [
                    { description: 'Child line 1' },
                    { description: 'Child line 2' },
                  ],
                },
              },
            };

            await runWithTenant(() =>
              call(parentModel, 'create', args, query),
            );

            expect(query).toHaveBeenCalledWith(
              expect.objectContaining({
                data: expect.objectContaining({
                  tenant_id: TENANT_ID,
                  [relField]: {
                    create: [
                      expect.objectContaining({
                        description: 'Child line 1',
                        tenant_id: TENANT_ID,
                      }),
                      expect.objectContaining({
                        description: 'Child line 2',
                        tenant_id: TENANT_ID,
                      }),
                    ],
                  },
                }),
              }),
            );
          },
        );

        it.each([
          ['PurchaseOrder', 'items', 'PurchaseOrderItem'],
          ['SalesOrder', 'items', 'SalesOrderItem'],
          ['Invoice', 'items', 'InvoiceItem'],
          ['CreditNote', 'items', 'CreditNoteItem'],
          ['PurchaseInvoice', 'lines', 'PurchaseInvoiceLine'],
          ['PartsRequisition', 'lines', 'PartsRequisitionLine'],
        ])(
          'rejects mismatching tenant_id in nested create for %s.%s',
          async (parentModel, relField, childModel) => {
            const query = jest.fn();
            const args = {
              data: {
                parent_code: 'TEST-1',
                [relField]: {
                  create: [
                    {
                      description: 'Adversarial line',
                      tenant_id: 'attacker-tenant',
                    },
                  ],
                },
              },
            };

            await expect(
              runWithTenant(() => call(parentModel, 'create', args, query)),
            ).rejects.toThrow(
              new RegExp(
                `\\[TenantIsolation\\] Mismatching tenant_id in create on model '${childModel}'\\.`,
              ),
            );
            expect(query).not.toHaveBeenCalled();
          },
        );

        it.each([
          ['PurchaseOrder', 'items', 'PurchaseOrderItem'],
          ['SalesOrder', 'items', 'SalesOrderItem'],
          ['Invoice', 'items', 'InvoiceItem'],
          ['CreditNote', 'items', 'CreditNoteItem'],
          ['PurchaseInvoice', 'lines', 'PurchaseInvoiceLine'],
          ['PartsRequisition', 'lines', 'PartsRequisitionLine'],
        ])(
          'rejects nested connect for %s.%s',
          async (parentModel, relField, childModel) => {
            const query = jest.fn();
            const args = {
              data: {
                parent_code: 'TEST-1',
                [relField]: {
                  connect: [{ id: 'child-1' }],
                },
              },
            };

            await expect(
              runWithTenant(() => call(parentModel, 'create', args, query)),
            ).rejects.toThrow(
              new RegExp(
                `\\[TenantIsolation\\] Nested relation write on '${parentModel}\\.${relField}' targeting tenant-scoped model '${childModel}' is not permitted\\.`,
              ),
            );
            expect(query).not.toHaveBeenCalled();
          },
        );

        it.each([
          'set',
          'update',
          'updateMany',
          'delete',
          'deleteMany',
          'disconnect',
        ])(
          'rejects unsafe nested mutation %s on PurchaseOrder.items',
          async (mutationKey) => {
            const query = jest.fn();
            const payload =
              mutationKey === 'delete' || mutationKey === 'disconnect'
                ? true
                : mutationKey === 'deleteMany' || mutationKey === 'updateMany'
                  ? {}
                  : [{ id: 'item-1' }];
            const args = {
              where: { id: 'po-1' },
              data: {
                items: {
                  [mutationKey]: payload,
                },
              },
            };

            await expect(
              runWithTenant(() => call('PurchaseOrder', 'update', args, query)),
            ).rejects.toThrow(
              /\[TenantIsolation\] Nested relation write on 'PurchaseOrder\.items' targeting tenant-scoped model 'PurchaseOrderItem' is not permitted\./,
            );
            expect(query).not.toHaveBeenCalled();
          },
        );

        it('stamps tenant_id in nested createMany for Invoice.items', async () => {
          const query = jest.fn().mockImplementation((a) => Promise.resolve(a));
          const args = {
            data: {
              currency: 'EUR',
              items: {
                createMany: {
                  data: [
                    { description: 'Item 1' },
                    { description: 'Item 2', tenant_id: TENANT_ID },
                  ],
                },
              },
            },
          };

          await runWithTenant(() => call('Invoice', 'create', args, query));

          expect(query).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                tenant_id: TENANT_ID,
                items: {
                  createMany: {
                    data: [
                      expect.objectContaining({
                        description: 'Item 1',
                        tenant_id: TENANT_ID,
                      }),
                      expect.objectContaining({
                        description: 'Item 2',
                        tenant_id: TENANT_ID,
                      }),
                    ],
                  },
                },
              }),
            }),
          );
        });

        it('rejects nested relation write inside a single-FK child line item', async () => {
          const query = jest.fn();
          const args = {
            data: {
              order_number: 'PO-1',
              items: {
                create: [
                  {
                    description: 'Illegal nested write inside item',
                    catalog_item: { connect: { id: 'cat-item-1' } },
                  },
                ],
              },
            },
          };

          await expect(
            runWithTenant(() => call('PurchaseOrder', 'create', args, query)),
          ).rejects.toThrow(
            /\[TenantIsolation\] Nested relation write on 'PurchaseOrderItem\.catalog_item' targeting tenant-scoped model 'CatalogItem' is not permitted\./,
          );
          expect(query).not.toHaveBeenCalled();
        });
      });

      it('permits scalar JSON columns containing mutation-like keys without mistaking them for relations', async () => {
        const query = jest.fn().mockImplementation((a) => Promise.resolve(a));
        const args = {
          data: {
            source_system: 'legacy-system',
            file_name: 'test.csv',
            status: 'COMPLETED',
            totals_json: {
              create: 5,
              update: 2,
              skip: 0,
              error: 0,
            },
          },
        };

        await runWithTenant(() => call('ImportJob', 'create', args, query));
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              tenant_id: TENANT_ID,
              totals_json: {
                create: 5,
                update: 2,
                skip: 0,
                error: 0,
              },
            }),
          }),
        );
      });

      it('permits scalar update using Prisma set clause (e.g. email: { set: val })', async () => {
        const query = jest.fn().mockImplementation((a) => Promise.resolve(a));
        const args = {
          where: { id: 'cust-1' },
          data: {
            email: { set: 'new@example.com' },
          },
        };

        await runWithTenant(() => call('Customer', 'update', args, query));
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { email: { set: 'new@example.com' } },
          }),
        );
      });

      it('rejects nested relation write in createMany payload', async () => {
        const query = jest.fn();
        const args = {
          data: [
            {
              order_number: 'WO-1',
              customer: { connect: { id: 'cust-1' } },
            },
          ],
        };

        await expect(
          runWithTenant(() => call('WorkshopOrder', 'createMany', args, query)),
        ).rejects.toThrow(
          /\[TenantIsolation\] Nested relation write on 'WorkshopOrder\.customer' targeting tenant-scoped model 'Customer' is not permitted\./,
        );
        expect(query).not.toHaveBeenCalled();
      });

      it('rejects nested relation write in upsert.create and upsert.update', async () => {
        const query = jest.fn();
        const argsCreate = {
          where: { tenant_id_code: { tenant_id: TENANT_ID, code: 'LOC-1' } },
          create: {
            code: 'LOC-1',
            name: 'Main',
            stagingWorkshopOrders: { connect: [{ id: 'wo-1' }] },
          },
          update: { name: 'Updated' },
        };

        await expect(
          runWithTenant(() =>
            call('StorageLocation', 'upsert', argsCreate, query),
          ),
        ).rejects.toThrow(/\[TenantIsolation\] Nested relation write/);

        const argsUpdate = {
          where: { tenant_id_code: { tenant_id: TENANT_ID, code: 'LOC-1' } },
          create: { code: 'LOC-1', name: 'Main' },
          update: {
            name: 'Updated',
            stagingWorkshopOrders: { connect: [{ id: 'wo-1' }] },
          },
        };

        await expect(
          runWithTenant(() =>
            call('StorageLocation', 'upsert', argsUpdate, query),
          ),
        ).rejects.toThrow(/\[TenantIsolation\] Nested relation write/);
        expect(query).not.toHaveBeenCalled();
      });
    });

    describe('depth 2 writes targeting tenant-scoped models', () => {
      it('rejects nested relation write wrapped inside a container object at depth 2', async () => {
        const query = jest.fn();
        const args = {
          data: {
            order_number: 'WO-101',
            metadata: {
              customer: { connect: { id: 'cust-1' } },
            },
          },
        };

        await expect(
          runWithTenant(() => call('WorkshopOrder', 'create', args, query)),
        ).rejects.toThrow(/\[TenantIsolation\] Nested relation write/);
        expect(query).not.toHaveBeenCalled();
      });

      it('rejects nested relation write inside an array at depth 2', async () => {
        const query = jest.fn();
        const args = {
          data: {
            order_number: 'WO-101',
            steps: [{ customer: { connect: { id: 'cust-1' } } }],
          },
        };

        await expect(
          runWithTenant(() => call('WorkshopOrder', 'create', args, query)),
        ).rejects.toThrow(/\[TenantIsolation\] Nested relation write/);
        expect(query).not.toHaveBeenCalled();
      });

      it('rejects nested relation write inside a global model relation at depth 2', async () => {
        const query = jest.fn();
        const args = {
          data: {
            order_number: 'WO-101',
            user: {
              create: {
                name: 'Global User',
                workshopOrdersAsMechanic: { connect: [{ id: 'wo-2' }] },
              },
            },
          },
        };

        await expect(
          runWithTenant(() => call('WorkshopOrder', 'create', args, query)),
        ).rejects.toThrow(/\[TenantIsolation\] Nested relation write/);
        expect(query).not.toHaveBeenCalled();
      });
    });

    it('allows writes with regular scalars and non-tenant global relations without nested writes', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'wo-1' });
      const args = {
        data: {
          order_number: 'WO-101',
          status: 'DRAFT',
          total_price: 100.5,
          user: {
            connect: { id: 'user-1' },
          },
        },
      };

      await runWithTenant(() => call('WorkshopOrder', 'create', args, query));

      expect(query).toHaveBeenCalledWith({
        data: {
          order_number: 'WO-101',
          status: 'DRAFT',
          total_price: 100.5,
          user: {
            connect: { id: 'user-1' },
          },
          tenant_id: TENANT_ID,
        },
      });
    });
  });

  describe('findUnique() — must throw', () => {
    it('throws a developer-facing Error for findUnique', async () => {
      const query = jest.fn();

      await expect(
        runWithTenant(() =>
          call('SalesOrder', 'findUnique', { where: { id: '1' } }, query),
        ),
      ).rejects.toThrow(/Do not use findUnique\(\)/);

      expect(query).not.toHaveBeenCalled();
    });

    it('throws a developer-facing Error for findUniqueOrThrow', async () => {
      const query = jest.fn();

      await expect(
        runWithTenant(() =>
          call('Invoice', 'findUniqueOrThrow', { where: { id: '1' } }, query),
        ),
      ).rejects.toThrow(/Do not use findUniqueOrThrow\(\)/);

      expect(query).not.toHaveBeenCalled();
    });

    it('never issues a base-client query for findUnique inside a transaction', async () => {
      const query = jest.fn();
      const baseClient = createBaseClient('SalesOrder');
      const tx = createTransactionClient();

      await expect(
        runWithTenant(() =>
          PrismaTransactionContext.run(tx, () =>
            call(
              'SalesOrder',
              'findUnique',
              { where: { id: '1' } },
              query,
              baseClient,
            ),
          ),
        ),
      ).rejects.toThrow(/Do not use findUnique\(\)/);

      expect(query).not.toHaveBeenCalled();
      expect(baseClient.salesOrder.findUnique).not.toHaveBeenCalled();
    });

    it('never issues a base-client query for findUniqueOrThrow inside a dry run', async () => {
      const query = jest.fn();
      const baseClient = createBaseClient('Invoice');
      const tx = createTransactionClient();

      await expect(
        runWithTenant(() =>
          DryRunStorage.run({ isDryRun: true, tx }, () =>
            call(
              'Invoice',
              'findUniqueOrThrow',
              { where: { id: '1' } },
              query,
              baseClient,
            ),
          ),
        ),
      ).rejects.toThrow(/Do not use findUniqueOrThrow\(\)/);

      expect(query).not.toHaveBeenCalled();
      expect(baseClient.invoice.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('no tenant context', () => {
    it('throws InternalServerErrorException when called outside a tenant context', async () => {
      const query = jest.fn();

      await expect(
        call('SalesOrder', 'count', { where: {} }, query),
      ).rejects.toThrow(InternalServerErrorException);

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('Prisma model operations classification and fail-closed policy', () => {
    it('covers all model delegate operations in ALL_PRISMA_OPERATIONS', () => {
      const expectedOperations = [
        'findUnique',
        'findUniqueOrThrow',
        'findFirst',
        'findFirstOrThrow',
        'findMany',
        'create',
        'createMany',
        'createManyAndReturn',
        'update',
        'updateMany',
        'updateManyAndReturn',
        'upsert',
        'delete',
        'deleteMany',
        'count',
        'aggregate',
        'groupBy',
        'findRaw',
        'aggregateRaw',
      ];

      expect([...ALL_PRISMA_OPERATIONS].sort()).toEqual(
        [...expectedOperations].sort(),
      );

      for (const op of ALL_PRISMA_OPERATIONS) {
        expect(OPERATION_CLASSIFICATIONS).toHaveProperty(op);
        expect(['scoped', 'stamped', 'rejected', 'composite']).toContain(
          OPERATION_CLASSIFICATIONS[op],
        );
      }
    });

    it('throws and logs when an unknown operation is invoked on a tenant-scoped model', async () => {
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const query = jest.fn();
      const sensitiveData = { secretField: 'top-secret-password-123' };

      await expect(
        runWithTenant(() =>
          call(
            'WorkshopOrder',
            'unsupportedFuturePrismaOp',
            { data: sensitiveData },
            query,
          ),
        ),
      ).rejects.toThrow(
        /\[TenantIsolation\] Operation 'unsupportedFuturePrismaOp' on model 'WorkshopOrder' is not permitted by tenant isolation policy\./,
      );

      expect(query).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "[TenantIsolation] Denied unhandled operation 'unsupportedFuturePrismaOp' on model 'WorkshopOrder'.",
      );
      const loggedMessages = loggerErrorSpy.mock.calls
        .map((args) => args.join(' '))
        .join(' ');
      expect(loggedMessages).not.toContain('top-secret');
      expect(loggedMessages).not.toContain('secretField');

      loggerErrorSpy.mockRestore();
    });

    it('passes through unknown operations on GLOBAL_MODELS', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'u-1' });
      const args = { someArg: true };

      const result = await runWithTenant(() =>
        call('User', 'unsupportedFuturePrismaOp', args, query),
      );

      expect(query).toHaveBeenCalledWith(args);
      expect(result).toEqual({ id: 'u-1' });
    });

    describe.each(ALL_PRISMA_OPERATIONS)('operation: %s', (op) => {
      it(`enforces ${OPERATION_CLASSIFICATIONS[op]} behavior on a tenant-scoped model`, async () => {
        const classification = OPERATION_CLASSIFICATIONS[op];
        const query = jest.fn().mockResolvedValue({ id: 'row-1' });

        if (classification === 'rejected') {
          await expect(
            runWithTenant(() =>
              call('SalesOrder', op, { where: { id: '1' } }, query),
            ),
          ).rejects.toThrow(/\[TenantIsolation\]/);
          expect(query).not.toHaveBeenCalled();
          return;
        }

        if (classification === 'stamped') {
          if (op === 'create') {
            await runWithTenant(() =>
              call(
                'SalesOrder',
                op,
                { data: { order_number: 'SO-101' } },
                query,
              ),
            );
            expect(query).toHaveBeenCalledWith({
              data: { order_number: 'SO-101', tenant_id: TENANT_ID },
            });
          } else {
            await runWithTenant(() =>
              call(
                'SalesOrder',
                op,
                { data: [{ order_number: 'SO-101' }] },
                query,
              ),
            );
            expect(query).toHaveBeenCalledWith({
              data: [{ order_number: 'SO-101', tenant_id: TENANT_ID }],
            });
          }
          return;
        }

        if (classification === 'scoped') {
          if (op === 'update' || op === 'delete') {
            await runWithTenant(() =>
              call(
                'SalesOrder',
                op,
                { where: { id: 'row-1' }, data: { status: 'DRAFT' } },
                query,
              ),
            );
            expect(query).toHaveBeenCalledWith(
              expect.objectContaining({
                where: expect.objectContaining({ tenant_id: TENANT_ID }),
              }),
            );
          } else {
            await runWithTenant(() =>
              call('SalesOrder', op, { where: { status: 'DRAFT' } }, query),
            );
            expect(query).toHaveBeenCalledWith(
              expect.objectContaining({
                where: expect.objectContaining({ tenant_id: TENANT_ID }),
              }),
            );
          }
          return;
        }

        if (classification === 'composite') {
          await runWithTenant(() =>
            call(
              'StorageLocation',
              op,
              {
                where: { tenant_id_code: { tenant_id: 'old', code: 'LOC-1' } },
                create: { code: 'LOC-1', name: 'Main' },
                update: { name: 'Main Updated' },
              },
              query,
            ),
          );
          expect(query).toHaveBeenCalledWith({
            where: { tenant_id_code: { tenant_id: TENANT_ID, code: 'LOC-1' } },
            create: { code: 'LOC-1', name: 'Main', tenant_id: TENANT_ID },
            update: { name: 'Main Updated' },
          });
          return;
        }
      });

      it(`passes through operation ${op} on a GLOBAL_MODEL`, async () => {
        const query = jest.fn().mockResolvedValue({ id: 'global-1' });
        const sampleArgs = {
          where: { id: 'global-1' },
          data: { name: 'Global' },
        };

        await runWithTenant(() => call('Tenant', op, sampleArgs, query));

        expect(query).toHaveBeenCalledWith(sampleArgs);
      });
    });
  });
});
