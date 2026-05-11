import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { applyTenantIsolation } from './tenant-isolation.extension';
import { TenantContextStorage } from '../common/services/tenant-context.storage';

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
) {
  return applyTenantIsolation(model, operation, args, queryFn);
}

describe('applyTenantIsolation', () => {
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

  describe('update() — must verify tenant ownership', () => {
    it('executes tenant-scoped unique updates without resolving a delegate', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'settings-1' });
      const getExtensionContextSpy = jest
        .spyOn(Prisma, 'getExtensionContext')
        .mockReturnValue({} as never);

      try {
        await runWithTenant(() =>
          applyTenantIsolation.call(
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
      } finally {
        getExtensionContextSpy.mockRestore();
      }

      expect(query).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
        data: { workshop_order_prefix: 'WO-2026-' },
      });
    });

    it('tenant-scopes the ownership pre-check when lower-camel delegates are unavailable', async () => {
      const query = jest.fn().mockResolvedValue({ id: 'settings-1' });
      const findFirst = jest.fn().mockResolvedValue({ id: 'settings-1' });
      const getExtensionContextSpy = jest
        .spyOn(Prisma, 'getExtensionContext')
        .mockReturnValue({
          FinanceSettings: { findFirst },
        } as never);

      try {
        await runWithTenant(() =>
          applyTenantIsolation.call(
            {},
            'FinanceSettings',
            'update',
            {
              where: { id: 'settings-1' },
              data: { workshop_order_prefix: 'WO-2026-' },
            },
            query,
          ),
        );
      } finally {
        getExtensionContextSpy.mockRestore();
      }

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'settings-1' }, { tenant_id: TENANT_ID }],
        },
        select: { id: true },
      });
      expect(query).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { workshop_order_prefix: 'WO-2026-' },
      });
    });
  });

  describe('create() — must stamp tenant_id', () => {
    it('injects tenant_id into data', async () => {
      const query = jest.fn().mockResolvedValue({ id: '1', tenant_id: TENANT_ID });
      const args = { data: { name: 'Test', status: 'DRAFT' } };

      await runWithTenant(() => call('SalesOrder', 'create', args, query));

      expect(query).toHaveBeenCalledWith({
        data: { name: 'Test', status: 'DRAFT', tenant_id: TENANT_ID },
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

    it('throws when upsert where selector does not include tenant_id', async () => {
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
      ).rejects.toThrow(/must use a tenant-scoped unique selector containing tenant_id/);
      expect(query).not.toHaveBeenCalled();
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
});
