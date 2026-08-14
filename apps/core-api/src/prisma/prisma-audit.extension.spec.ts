import { InternalServerErrorException } from '@nestjs/common';
import {
  applyAuditDelete,
  applyAuditUpdate,
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
  let mockContext: Record<string, unknown>;

  beforeEach(() => {
    mockAuditLogCreate = jest.fn().mockResolvedValue({ id: 'audit-log-1' });
    mockModelFindFirst = jest.fn();
    mockContext = {
      auditLog: {
        create: mockAuditLogCreate,
      },
      customer: {
        findFirst: mockModelFindFirst,
      },
      vendor: {
        findFirst: mockModelFindFirst,
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

      expect(AUDITED_MODELS.has('AuditLog')).toBe(false);
      expect(AUDITED_MODELS.has('Tenant')).toBe(false);
      expect(AUDITED_MODELS.has('User')).toBe(false);
      expect(AUDITED_MODELS.has('PlatformAdmin')).toBe(false);
    });
  });
});
