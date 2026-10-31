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
      const source = readFileSync(join(import.meta.dirname, extensionFile), 'utf8');

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
      const query = jest.fn().mockResolvedValue([
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
