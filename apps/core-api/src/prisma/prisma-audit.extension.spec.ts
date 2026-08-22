import { InternalServerErrorException } from '@nestjs/common';
import {
  applyAuditDelete,
  applyAuditDeleteMany,
  applyAuditUpdate,
  applyAuditUpdateMany,
  AUDITED_MODELS,
  createAuditExtension,
} from './prisma-audit.extension';
import { TenantContextStorage } from '../common/services/tenant-context.storage';
import { REDACTED_VALUE } from '../audit/audit-redaction.util';

const TENANT_ID = 'tenant-audit-123';

function runWithContext<T>(
  userOverrides?: { userId?: string; email?: string; role?: string; tenantId?: string },
  metaOverrides?: { requestId?: string; source?: 'API' | 'JOB' | 'SCRIPT'; ip?: string; userAgent?: string },
  fn?: () => T,
): T {
  const callback = fn ?? (() => (undefined as unknown as T));
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: userOverrides?.userId ?? 'user-1',
      email: userOverrides?.email ?? 'admin@example.com',
      tenantId: userOverrides?.tenantId ?? TENANT_ID,
      role: userOverrides?.role ?? 'ADMIN',
    });
    TenantContextStorage.setRequestMeta({
      requestId: metaOverrides?.requestId ?? 'req-123',
      source: metaOverrides?.source ?? 'API',
      ip: metaOverrides?.ip ?? '127.0.0.1',
      userAgent: metaOverrides?.userAgent ?? 'Mozilla/5.0 TestBrowser',
    });
    return callback();
  });
}

describe('Prisma Audit Extension', () => {
  let mockAuditLogCreate: jest.Mock;
  let mockModelFindFirst: jest.Mock;
  let mockModelFindMany: jest.Mock;
  let mockContext: Record<string, unknown>;

  beforeEach(() => {
    mockAuditLogCreate = jest.fn().mockResolvedValue({ id: 'audit-log-1' });
    mockModelFindFirst = jest.fn();
    mockModelFindMany = jest.fn();
    mockContext = {
      auditLog: {
        create: mockAuditLogCreate,
      },
      customer: {
        findFirst: mockModelFindFirst,
        findMany: mockModelFindMany,
      },
      vendor: {
        findFirst: mockModelFindFirst,
        findMany: mockModelFindMany,
      },
      salesOrder: {
        findFirst: mockModelFindFirst,
        findMany: mockModelFindMany,
      },
      purchaseOrderItem: {
        findFirst: mockModelFindFirst,
        findMany: mockModelFindMany,
      },
    };
  });

  describe('applyAuditUpdate', () => {
    it('captures before and after snapshots, diff, and writes AuditLog for audited models', async () => {
      const beforeRow = {
        id: 'cust-1',
        name: 'Old Customer Name',
        email: 'old@example.com',
        phone: '123456',
      };
      const afterRow = {
        id: 'cust-1',
        name: 'New Customer Name',
        email: 'new@example.com',
        phone: '123456',
      };

      mockModelFindFirst.mockResolvedValue(beforeRow);
      const queryFn = jest.fn().mockResolvedValue(afterRow);

      const result = await runWithContext(
        { userId: 'user-1', email: 'user@example.com', role: 'MANAGER' },
        { requestId: 'req-abc', source: 'API', ip: '192.168.1.1', userAgent: 'Chrome/120' },
        () =>
          applyAuditUpdate.call(
            mockContext,
            mockContext,
            'Customer',
            { where: { id: 'cust-1' }, data: { name: 'New Customer Name', email: 'new@example.com' } },
            queryFn,
          ),
      );

      expect(result).toEqual(afterRow);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockModelFindFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
      });

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'Customer',
          entity_id: 'cust-1',
          action: 'UPDATE',
          actor_user_id: 'user-1',
          actor_email: 'user@example.com',
          actor_role: 'MANAGER',
          actor_type: 'USER',
          request_id: 'req-abc',
          source: 'API',
          ip_address: '192.168.1.1',
          user_agent: 'Chrome/120',
          before: beforeRow,
          after: afterRow,
          diff: {
            email: { before: 'old@example.com', after: 'new@example.com' },
            name: { before: 'Old Customer Name', after: 'New Customer Name' },
          },
          changed_fields: ['email', 'name'],
          redacted_fields: [],
        },
      });
    });

    it('redacts secret fields in before/after snapshots and logs redacted paths', async () => {
      const beforeRow = {
        id: 'vend-1',
        name: 'Vendor A',
        apiKey: 'secret-key-1',
      };
      const afterRow = {
        id: 'vend-1',
        name: 'Vendor A Updated',
        apiKey: 'secret-key-2',
      };

      mockModelFindFirst.mockResolvedValue(beforeRow);
      const queryFn = jest.fn().mockResolvedValue(afterRow);

      await runWithContext(undefined, undefined, () =>
        applyAuditUpdate.call(
          mockContext,
          mockContext,
          'Vendor',
          { where: { id: 'vend-1' }, data: { name: 'Vendor A Updated', apiKey: 'secret-key-2' } },
          queryFn,
        ),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            before: {
              id: 'vend-1',
              name: 'Vendor A',
              apiKey: REDACTED_VALUE,
            },
            after: {
              id: 'vend-1',
              name: 'Vendor A Updated',
              apiKey: REDACTED_VALUE,
            },
            diff: {
              name: { before: 'Vendor A', after: 'Vendor A Updated' },
            },
            changed_fields: ['name'],
            redacted_fields: ['apiKey'],
          }),
        }),
      );
    });

    it('stamps SYSTEM actor_type for JOB source or worker role', async () => {
      const row = { id: 'cust-1', name: 'Customer' };
      mockModelFindFirst.mockResolvedValue(row);
      const queryFn = jest.fn().mockResolvedValue({ ...row, name: 'Updated' });

      await runWithContext(
        { userId: 'cloud-tasks-worker', email: '', role: 'worker' },
        { source: 'JOB' },
        () =>
          applyAuditUpdate.call(
            mockContext,
            mockContext,
            'Customer',
            { where: { id: 'cust-1' }, data: { name: 'Updated' } },
            queryFn,
          ),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor_type: 'SYSTEM',
            source: 'JOB',
          }),
        }),
      );
    });

    it('stamps MIGRATION actor_type for SCRIPT source', async () => {
      const row = { id: 'cust-1', name: 'Customer' };
      mockModelFindFirst.mockResolvedValue(row);
      const queryFn = jest.fn().mockResolvedValue({ ...row, name: 'Updated' });

      await runWithContext(
        { userId: 'script-runner', email: '', role: 'ADMIN' },
        { source: 'SCRIPT' },
        () =>
          applyAuditUpdate.call(
            mockContext,
            mockContext,
            'Customer',
            { where: { id: 'cust-1' }, data: { name: 'Updated' } },
            queryFn,
          ),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor_type: 'MIGRATION',
            source: 'SCRIPT',
          }),
        }),
      );
    });

    it('bypasses non-audited models without calling auditLog.create', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'New Tenant' });

      const result = await runWithContext(undefined, undefined, () =>
        applyAuditUpdate.call(
          mockContext,
          mockContext,
          'Tenant',
          { where: { id: 'tenant-1' }, data: { name: 'New Tenant' } },
          queryFn,
        ),
      );

      expect(result).toEqual({ id: 'tenant-1', name: 'New Tenant' });
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('strictly prevents recursive auditing on AuditLog model', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: 'audit-log-1' });

      await runWithContext(undefined, undefined, () =>
        applyAuditUpdate.call(
          mockContext,
          mockContext,
          'AuditLog',
          { where: { id: 'audit-log-1' }, data: {} },
          queryFn,
        ),
      );

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when tenant context is missing for audited model', async () => {
      const queryFn = jest.fn();

      await expect(
        applyAuditUpdate.call(
          mockContext,
          mockContext,
          'Customer',
          { where: { id: 'cust-1' }, data: { name: 'New' } },
          queryFn,
        ),
      ).rejects.toThrow(InternalServerErrorException);

      expect(queryFn).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('does not write AuditLog when business mutation query throws', async () => {
      mockModelFindFirst.mockResolvedValue({ id: 'cust-1', name: 'Customer' });
      const queryFn = jest.fn().mockRejectedValue(new Error('DB update failed'));

      await expect(
        runWithContext(undefined, undefined, () =>
          applyAuditUpdate.call(
            mockContext,
            mockContext,
            'Customer',
            { where: { id: 'cust-1' }, data: { name: 'New' } },
            queryFn,
          ),
        ),
      ).rejects.toThrow('DB update failed');

      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
  });

  describe('applyAuditDelete', () => {
    it('captures before snapshot, after null, and writes AuditLog with action DELETE', async () => {
      const beforeRow = {
        id: 'cust-1',
        name: 'Deleted Customer',
        phone: '999999',
      };
      mockModelFindFirst.mockResolvedValue(beforeRow);
      const queryFn = jest.fn().mockResolvedValue(beforeRow);

      const result = await runWithContext(
        { userId: 'user-2', email: 'admin@acme.com', role: 'ADMIN' },
        { requestId: 'req-del-1', source: 'API' },
        () =>
          applyAuditDelete.call(
            mockContext,
            mockContext,
            'Customer',
            { where: { id: 'cust-1' } },
            queryFn,
          ),
      );

      expect(result).toEqual(beforeRow);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockModelFindFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'Customer',
          entity_id: 'cust-1',
          action: 'DELETE',
          actor_user_id: 'user-2',
          actor_email: 'admin@acme.com',
          actor_role: 'ADMIN',
          actor_type: 'USER',
          request_id: 'req-del-1',
          source: 'API',
          ip_address: '127.0.0.1',
          user_agent: 'Mozilla/5.0 TestBrowser',
          before: beforeRow,
          after: null,
          diff: null,
          changed_fields: [],
          redacted_fields: [],
        },
      });
    });

    it('redacts secrets in before snapshot on delete', async () => {
      const beforeRow = {
        id: 'vend-1',
        name: 'Deleted Vendor',
        authorizationHeader: 'Bearer secret-token',
      };
      mockModelFindFirst.mockResolvedValue(beforeRow);
      const queryFn = jest.fn().mockResolvedValue(beforeRow);

      await runWithContext(undefined, undefined, () =>
        applyAuditDelete.call(
          mockContext,
          mockContext,
          'Vendor',
          { where: { id: 'vend-1' } },
          queryFn,
        ),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DELETE',
            before: {
              id: 'vend-1',
              name: 'Deleted Vendor',
              authorizationHeader: REDACTED_VALUE,
            },
            after: null,
            diff: null,
            changed_fields: [],
            redacted_fields: ['authorizationHeader'],
          }),
        }),
      );
    });

    it('bypasses non-audited models on delete without writing AuditLog', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: 'tenant-1' });

      await runWithContext(undefined, undefined, () =>
        applyAuditDelete.call(
          mockContext,
          mockContext,
          'Tenant',
          { where: { id: 'tenant-1' } },
          queryFn,
        ),
      );

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('does not write AuditLog when delete query throws', async () => {
      mockModelFindFirst.mockResolvedValue({ id: 'cust-1' });
      const queryFn = jest.fn().mockRejectedValue(new Error('FK constraint'));

      await expect(
        runWithContext(undefined, undefined, () =>
          applyAuditDelete.call(
            mockContext,
            mockContext,
            'Customer',
            { where: { id: 'cust-1' } },
            queryFn,
          ),
        ),
      ).rejects.toThrow('FK constraint');

      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
  });

  describe('applyAuditUpdateMany', () => {
    it('preserves atomic status guard updateMany and writes exactly 1 AuditLog per affected row', async () => {
      const beforeRow = { id: 'so-1', status: 'CONFIRMED', total: 100 };
      const afterRow = { id: 'so-1', status: 'IN_PROGRESS', total: 100 };

      mockModelFindMany
        .mockResolvedValueOnce([beforeRow]) // prefetch before
        .mockResolvedValueOnce([afterRow]); // postfetch after

      const queryFn = jest.fn().mockResolvedValue({ count: 1 });

      const result = await runWithContext(
        { userId: 'user-1', email: 'user@example.com', role: 'MANAGER' },
        { requestId: 'req-guard-1', source: 'API' },
        () =>
          applyAuditUpdateMany.call(
            mockContext,
            mockContext,
            'SalesOrder',
            {
              where: { id: 'so-1', status: 'CONFIRMED' },
              data: { status: 'IN_PROGRESS' },
            },
            queryFn,
          ),
      );

      expect(result).toEqual({ count: 1 });
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockModelFindMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'so-1', status: 'CONFIRMED' },
      });
      expect(mockModelFindMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['so-1'] } },
      });

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'SalesOrder',
          entity_id: 'so-1',
          action: 'UPDATE',
          actor_user_id: 'user-1',
          actor_email: 'user@example.com',
          actor_role: 'MANAGER',
          actor_type: 'USER',
          request_id: 'req-guard-1',
          source: 'API',
          ip_address: '127.0.0.1',
          user_agent: 'Mozilla/5.0 TestBrowser',
          before: beforeRow,
          after: afterRow,
          diff: {
            status: { before: 'CONFIRMED', after: 'IN_PROGRESS' },
          },
          changed_fields: ['status'],
          redacted_fields: [],
        },
      });
    });

    it('writes individual AuditLog records for each row affected in multi-row updateMany (never an aggregate record)', async () => {
      const beforeRows = [
        { id: 'poi-1', quantity: 2, unitPrice: 10 },
        { id: 'poi-2', quantity: 5, unitPrice: 20 },
      ];
      const afterRows = [
        { id: 'poi-1', quantity: 3, unitPrice: 10 },
        { id: 'poi-2', quantity: 6, unitPrice: 20 },
      ];

      mockModelFindMany
        .mockResolvedValueOnce(beforeRows)
        .mockResolvedValueOnce(afterRows);

      const queryFn = jest.fn().mockResolvedValue({ count: 2 });

      const result = await runWithContext(undefined, undefined, () =>
        applyAuditUpdateMany.call(
          mockContext,
          mockContext,
          'PurchaseOrderItem',
          {
            where: { po_id: 'po-1' },
            data: { status: 'RECEIVED' },
          },
          queryFn,
        ),
      );

      expect(result).toEqual({ count: 2 });
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
      expect(mockAuditLogCreate).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          entity_type: 'PurchaseOrderItem',
          entity_id: 'poi-1',
          action: 'UPDATE',
          diff: {
            quantity: { before: 2, after: 3 },
          },
          changed_fields: ['quantity'],
        }),
      });
      expect(mockAuditLogCreate).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          entity_type: 'PurchaseOrderItem',
          entity_id: 'poi-2',
          action: 'UPDATE',
          diff: {
            quantity: { before: 5, after: 6 },
          },
          changed_fields: ['quantity'],
        }),
      });
    });

    it('writes 0 audit logs and returns count 0 when no rows match or atomic status guard fails', async () => {
      mockModelFindMany.mockResolvedValue([]);
      const queryFn = jest.fn().mockResolvedValue({ count: 0 });

      const result = await runWithContext(undefined, undefined, () =>
        applyAuditUpdateMany.call(
          mockContext,
          mockContext,
          'SalesOrder',
          {
            where: { id: 'so-1', status: 'CONFIRMED' },
            data: { status: 'IN_PROGRESS' },
          },
          queryFn,
        ),
      );

      expect(result).toEqual({ count: 0 });
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('redacts secrets in multi-row updateMany snapshots', async () => {
      const beforeRows = [
        { id: 'vend-1', apiKey: 'key-1', name: 'Vendor 1' },
        { id: 'vend-2', apiKey: 'key-2', name: 'Vendor 2' },
      ];
      const afterRows = [
        { id: 'vend-1', apiKey: 'key-1-new', name: 'Vendor 1 Updated' },
        { id: 'vend-2', apiKey: 'key-2-new', name: 'Vendor 2 Updated' },
      ];

      mockModelFindMany
        .mockResolvedValueOnce(beforeRows)
        .mockResolvedValueOnce(afterRows);

      const queryFn = jest.fn().mockResolvedValue({ count: 2 });

      await runWithContext(undefined, undefined, () =>
        applyAuditUpdateMany.call(
          mockContext,
          mockContext,
          'Vendor',
          { where: {}, data: { active: true } },
          queryFn,
        ),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
      expect(mockAuditLogCreate).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          before: { id: 'vend-1', apiKey: REDACTED_VALUE, name: 'Vendor 1' },
          after: { id: 'vend-1', apiKey: REDACTED_VALUE, name: 'Vendor 1 Updated' },
          redacted_fields: ['apiKey'],
        }),
      });
      expect(mockAuditLogCreate).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          before: { id: 'vend-2', apiKey: REDACTED_VALUE, name: 'Vendor 2' },
          after: { id: 'vend-2', apiKey: REDACTED_VALUE, name: 'Vendor 2 Updated' },
          redacted_fields: ['apiKey'],
        }),
      });
    });

    it('bypasses non-audited models without writing audit logs in updateMany', async () => {
      const queryFn = jest.fn().mockResolvedValue({ count: 5 });

      const result = await runWithContext(undefined, undefined, () =>
        applyAuditUpdateMany.call(
          mockContext,
          mockContext,
          'Tenant',
          { where: {}, data: {} },
          queryFn,
        ),
      );

      expect(result).toEqual({ count: 5 });
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when tenant context is missing on updateMany', async () => {
      const queryFn = jest.fn();

      await expect(
        applyAuditUpdateMany.call(
          mockContext,
          mockContext,
          'Customer',
          { where: {}, data: {} },
          queryFn,
        ),
      ).rejects.toThrow(InternalServerErrorException);

      expect(queryFn).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
  });

  describe('applyAuditDeleteMany', () => {
    it('writes individual DELETE audit log records for each deleted row', async () => {
      const beforeRows = [
        { id: 'poi-1', quantity: 2, item_name: 'Filter' },
        { id: 'poi-2', quantity: 4, item_name: 'Gasket' },
      ];

      mockModelFindMany.mockResolvedValue(beforeRows);
      const queryFn = jest.fn().mockResolvedValue({ count: 2 });

      const result = await runWithContext(
        { userId: 'user-del', email: 'del@acme.com', role: 'ADMIN' },
        { requestId: 'req-del-many', source: 'API' },
        () =>
          applyAuditDeleteMany.call(
            mockContext,
            mockContext,
            'PurchaseOrderItem',
            { where: { po_id: 'po-1' } },
            queryFn,
          ),
      );

      expect(result).toEqual({ count: 2 });
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
      expect(mockAuditLogCreate).toHaveBeenNthCalledWith(1, {
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'PurchaseOrderItem',
          entity_id: 'poi-1',
          action: 'DELETE',
          actor_user_id: 'user-del',
          actor_email: 'del@acme.com',
          actor_role: 'ADMIN',
          actor_type: 'USER',
          request_id: 'req-del-many',
          source: 'API',
          ip_address: '127.0.0.1',
          user_agent: 'Mozilla/5.0 TestBrowser',
          before: beforeRows[0],
          after: null,
          diff: null,
          changed_fields: [],
          redacted_fields: [],
        },
      });
      expect(mockAuditLogCreate).toHaveBeenNthCalledWith(2, {
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'PurchaseOrderItem',
          entity_id: 'poi-2',
          action: 'DELETE',
          actor_user_id: 'user-del',
          actor_email: 'del@acme.com',
          actor_role: 'ADMIN',
          actor_type: 'USER',
          request_id: 'req-del-many',
          source: 'API',
          ip_address: '127.0.0.1',
          user_agent: 'Mozilla/5.0 TestBrowser',
          before: beforeRows[1],
          after: null,
          diff: null,
          changed_fields: [],
          redacted_fields: [],
        },
      });
    });

    it('writes 0 audit logs when deleteMany affects 0 rows', async () => {
      mockModelFindMany.mockResolvedValue([]);
      const queryFn = jest.fn().mockResolvedValue({ count: 0 });

      const result = await runWithContext(undefined, undefined, () =>
        applyAuditDeleteMany.call(
          mockContext,
          mockContext,
          'Customer',
          { where: { id: 'non-existent' } },
          queryFn,
        ),
      );

      expect(result).toEqual({ count: 0 });
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('redacts secrets in deleteMany before snapshots', async () => {
      const beforeRows = [
        { id: 'vend-1', apiKey: 'secret-1', name: 'Vendor 1' },
      ];
      mockModelFindMany.mockResolvedValue(beforeRows);
      const queryFn = jest.fn().mockResolvedValue({ count: 1 });

      await runWithContext(undefined, undefined, () =>
        applyAuditDeleteMany.call(
          mockContext,
          mockContext,
          'Vendor',
          { where: { id: 'vend-1' } },
          queryFn,
        ),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DELETE',
            before: { id: 'vend-1', apiKey: REDACTED_VALUE, name: 'Vendor 1' },
            redacted_fields: ['apiKey'],
          }),
        }),
      );
    });

    it('bypasses non-audited models on deleteMany without writing audit logs', async () => {
      const queryFn = jest.fn().mockResolvedValue({ count: 3 });

      const result = await runWithContext(undefined, undefined, () =>
        applyAuditDeleteMany.call(
          mockContext,
          mockContext,
          'Tenant',
          { where: {} },
          queryFn,
        ),
      );

      expect(result).toEqual({ count: 3 });
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when tenant context is missing on deleteMany', async () => {
      const queryFn = jest.fn();

      await expect(
        applyAuditDeleteMany.call(
          mockContext,
          mockContext,
          'Customer',
          { where: {} },
          queryFn,
        ),
      ).rejects.toThrow(InternalServerErrorException);

      expect(queryFn).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
  });

  describe('createAuditExtension', () => {
    it('defines prisma extension', () => {
      const ext = createAuditExtension();
      expect(ext).toBeDefined();
    });
  });

  describe('AUDITED_MODELS', () => {
    it('includes core tenant ERP models and excludes internal models', () => {
      expect(AUDITED_MODELS.has('Customer')).toBe(true);
      expect(AUDITED_MODELS.has('Vendor')).toBe(true);
      expect(AUDITED_MODELS.has('Vehicle')).toBe(true);
      expect(AUDITED_MODELS.has('CatalogItem')).toBe(true);
      expect(AUDITED_MODELS.has('PurchaseOrder')).toBe(true);
      expect(AUDITED_MODELS.has('PurchaseInvoice')).toBe(true);
      expect(AUDITED_MODELS.has('PurchaseInvoiceLine')).toBe(true);
      expect(AUDITED_MODELS.has('SalesOrder')).toBe(true);
      expect(AUDITED_MODELS.has('Invoice')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopOrder')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopTask')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopTaskLineItem')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopMedia')).toBe(true);
      expect(AUDITED_MODELS.has('LaborEntry')).toBe(true);
      expect(AUDITED_MODELS.has('Bay')).toBe(true);
      expect(AUDITED_MODELS.has('Employee')).toBe(true);
      expect(AUDITED_MODELS.has('RevenueGroup')).toBe(true);
      expect(AUDITED_MODELS.has('StorageLocation')).toBe(true);
      expect(AUDITED_MODELS.has('Brand')).toBe(true);
      expect(AUDITED_MODELS.has('VehiclePurchase')).toBe(true);
      expect(AUDITED_MODELS.has('VehicleSale')).toBe(true);
      expect(AUDITED_MODELS.has('VehicleLedgerEntry')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopSettings')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopOpeningHour')).toBe(true);
      expect(AUDITED_MODELS.has('WorkshopHoliday')).toBe(true);
      expect(AUDITED_MODELS.has('EmployeeLeaveBalance')).toBe(true);
      expect(AUDITED_MODELS.has('LeaveRequest')).toBe(true);
      expect(AUDITED_MODELS.has('AttendanceEvent')).toBe(false);

      expect(AUDITED_MODELS.has('AuditLog')).toBe(false);
      expect(AUDITED_MODELS.has('Tenant')).toBe(false);
      expect(AUDITED_MODELS.has('User')).toBe(false);
      expect(AUDITED_MODELS.has('PlatformAdmin')).toBe(false);
    });
  });
});
