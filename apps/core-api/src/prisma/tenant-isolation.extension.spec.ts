import { InternalServerErrorException } from '@nestjs/common';
import { applyTenantIsolation } from './tenant-isolation.extension';
import { TenantContextStorage } from '../common/services/tenant-context.storage';

const TENANT_ID = 'tenant-test-123';

function runWithTenant(fn: () => unknown) {
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
  args: Record<string, unknown>,
  queryFn: jest.Mock,
) {
  return applyTenantIsolation(model, operation, args, queryFn);
}

describe('applyTenantIsolation', () => {
  describe('GLOBAL_MODELS (Tenant, Employee, Bay)', () => {
    it('passes through Tenant queries without injecting tenant_id', () => {
      const query = jest.fn().mockReturnValue([]);
      const args = { where: { slug: 'acme' } };

      runWithTenant(() => call('Tenant', 'findMany', args, query));

      expect(query).toHaveBeenCalledWith(args);
      expect(query.mock.calls[0][0]).not.toHaveProperty('where.tenant_id');
    });

    it('passes through Employee queries without injecting tenant_id', () => {
      const query = jest.fn().mockReturnValue([]);
      runWithTenant(() => call('Employee', 'findMany', { where: {} }, query));
      expect(query.mock.calls[0][0]).not.toHaveProperty('where.tenant_id');
    });

    it('passes through Bay queries without injecting tenant_id', () => {
      const query = jest.fn().mockReturnValue([]);
      runWithTenant(() => call('Bay', 'findMany', { where: {} }, query));
      expect(query.mock.calls[0][0]).not.toHaveProperty('where.tenant_id');
    });
  });

  describe('count() — must be scoped', () => {
    it('injects tenant_id into where for count()', () => {
      const query = jest.fn().mockReturnValue(5);
      const args = { where: {} };

      runWithTenant(() => call('SalesOrder', 'count', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });
  });

  describe('findMany() — must be scoped', () => {
    it('injects tenant_id into where while preserving existing filters', () => {
      const query = jest.fn().mockReturnValue([]);
      const args = { where: { status: 'DRAFT' } };

      runWithTenant(() => call('PurchaseOrder', 'findMany', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { status: 'DRAFT', tenant_id: TENANT_ID },
      });
    });
  });

  describe('create() — must stamp tenant_id', () => {
    it('injects tenant_id into data', () => {
      const query = jest.fn().mockReturnValue({ id: '1', tenant_id: TENANT_ID });
      const args = { data: { name: 'Test', status: 'DRAFT' } };

      runWithTenant(() => call('SalesOrder', 'create', args, query));

      expect(query).toHaveBeenCalledWith({
        data: { name: 'Test', status: 'DRAFT', tenant_id: TENANT_ID },
      });
    });
  });

  describe('upsert() — must stamp tenant_id in both where and create', () => {
    it('injects tenant_id into where and create', () => {
      const query = jest.fn().mockReturnValue({});
      const args = {
        where: { slug: 'default-workshop' },
        create: { name: 'Default', slug: 'default-workshop' },
        update: { name: 'Default' },
      };

      runWithTenant(() => call('RevenueGroup', 'upsert', args, query));

      expect(query).toHaveBeenCalledWith({
        where: { slug: 'default-workshop', tenant_id: TENANT_ID },
        create: {
          name: 'Default',
          slug: 'default-workshop',
          tenant_id: TENANT_ID,
        },
        update: { name: 'Default' },
      });
    });
  });

  describe('findUnique() — must throw', () => {
    it('throws a developer-facing Error for findUnique', () => {
      const query = jest.fn();

      expect(() =>
        runWithTenant(() =>
          call('SalesOrder', 'findUnique', { where: { id: '1' } }, query),
        ),
      ).toThrow(/Do not use findUnique\(\)/);

      expect(query).not.toHaveBeenCalled();
    });

    it('throws a developer-facing Error for findUniqueOrThrow', () => {
      const query = jest.fn();

      expect(() =>
        runWithTenant(() =>
          call('Invoice', 'findUniqueOrThrow', { where: { id: '1' } }, query),
        ),
      ).toThrow(/Do not use findUniqueOrThrow\(\)/);

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('no tenant context', () => {
    it('throws InternalServerErrorException when called outside a tenant context', () => {
      const query = jest.fn();

      // Deliberately NOT wrapping in runWithTenant
      expect(() =>
        call('SalesOrder', 'count', { where: {} }, query),
      ).toThrow(InternalServerErrorException);

      expect(query).not.toHaveBeenCalled();
    });
  });
});
