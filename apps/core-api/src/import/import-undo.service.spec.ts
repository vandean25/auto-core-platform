import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { ImportUndoService } from './import-undo.service.js';

describe('ImportUndoService', () => {
  const tenantId = 'tenant-123';
  const jobId = 'job-456';
  const appliedAt = new Date('2026-10-30T10:00:00.000Z');

  let service: ImportUndoService;
  let mockTenantContext: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'admin-user',
        email: 'admin@example.com',
        role: 'ADMIN',
      }),
    };

    mockPrisma = {
      importJob: {
        findFirst: jest.fn(),
        update: jest
          .fn()
          .mockResolvedValue({ id: jobId, status: ImportJobStatus.UNDONE }),
      },
      importJobRow: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customer: {
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicle: {
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      laborOperation: {
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      catalogItem: {
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      catalogPriceHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vendorArticle: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      externalIdMapping: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerConsentUnsubscribeToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customerCommunicationState: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      salesOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleSale: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehiclePurchase: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      loanerBooking: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleLedgerEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workshopTaskLineItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      inventoryTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      invoiceItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      purchaseOrderItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: jest.fn(async (callback: any) => callback(mockPrisma)),
    };

    service = new ImportUndoService(mockTenantContext, mockPrisma);
  });

  it('rejects with ForbiddenException for non-admin roles', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'tech-user',
      role: 'TECH',
    });

    await expect(service.undoJob(jobId)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when job does not exist', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue(null);

    await expect(service.undoJob(jobId)).rejects.toThrow(NotFoundException);
  });

  it('is a no-op when job status is already UNDONE (idempotent)', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      status: ImportJobStatus.UNDONE,
    });

    const result = await service.undoJob(jobId);
    expect(result.status).toBe(ImportJobStatus.UNDONE);
    expect(mockPrisma.customer.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('undoes created customers: deletes records, mappings, and writes audit logs', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 1, update: 0 },
      options_json: {},
    });

    mockPrisma.importJobRow.findMany.mockResolvedValue([
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: 'cust-1',
        normalized_json: { first_name: 'Max', last_name: 'Muster' },
      },
    ]);

    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      tenant_id: tenantId,
      updatedAt: new Date(appliedAt.getTime() - 1000),
    });

    const result = await service.undoJob(jobId);

    expect(result.status).toBe(ImportJobStatus.UNDONE);
    expect(mockPrisma.customer.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'cust-1' },
    });
    expect(mockPrisma.externalIdMapping.deleteMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        first_seen_import_job_id: jobId,
        entity_id: 'cust-1',
      },
    });
    // Entity-level and job-level audit logs written
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('undoes updated customers: restores prior snapshot fields and writes audit logs', async () => {
    const beforeSnapshot = {
      first_name: 'Original',
      last_name: 'Name',
      email: 'original@example.com',
      contact_email_ok: true,
    };

    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 0, update: 1 },
      options_json: {},
    });

    mockPrisma.importJobRow.findMany.mockResolvedValue([
      {
        row_no: 1,
        action: ImportRowAction.UPDATE,
        entity_id: 'cust-2',
        normalized_json: { first_name: 'Updated', last_name: 'Name' },
        before_snapshot_json: beforeSnapshot,
      },
    ]);

    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-2',
      tenant_id: tenantId,
      updatedAt: new Date(appliedAt.getTime() - 1000),
    });

    const result = await service.undoJob(jobId);

    expect(result.status).toBe(ImportJobStatus.UNDONE);
    expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'cust-2' },
      data: expect.objectContaining({
        first_name: 'Original',
        last_name: 'Name',
        email: 'original@example.com',
      }),
    });
  });

  it('undoes supplier price list: restores CatalogItem prices from CatalogPriceHistory', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 0, update: 1 },
      options_json: {},
    });

    mockPrisma.catalogPriceHistory.findMany.mockResolvedValue([
      {
        id: 'cph-1',
        catalog_item_id: 'item-1',
        old_cost: 15.0,
        new_cost: 25.0,
        old_retail: 30.0,
        new_retail: 50.0,
      },
    ]);

    mockPrisma.catalogItem.findFirst.mockResolvedValue({
      id: 'item-1',
      tenant_id: tenantId,
      updatedAt: new Date(appliedAt.getTime() - 1000),
    });

    const result = await service.undoJob(jobId);

    expect(result.status).toBe(ImportJobStatus.UNDONE);
    expect(mockPrisma.catalogItem.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'item-1' },
      data: { cost_price: 15.0, retail_price: 30.0 },
    });
    expect(mockPrisma.catalogPriceHistory.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, import_job_id: jobId },
    });
  });

  it('leaves blocked records untouched and transitions job to PARTIALLY_UNDONE', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 2, update: 0 },
      options_json: {},
    });

    mockPrisma.importJobRow.findMany.mockResolvedValue([
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: 'cust-clean',
        normalized_json: { first_name: 'Clean' },
      },
      {
        row_no: 2,
        action: ImportRowAction.CREATE,
        entity_id: 'cust-blocked',
        normalized_json: { first_name: 'Blocked' },
      },
    ]);

    mockPrisma.customer.findFirst
      .mockResolvedValueOnce({
        id: 'cust-clean',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      })
      .mockResolvedValueOnce({
        id: 'cust-blocked',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });

    // cust-blocked has an invoice
    mockPrisma.invoice.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'inv-1', invoice_number: 'RE-2026-1' });

    mockPrisma.importJob.update.mockResolvedValue({
      id: jobId,
      status: ImportJobStatus.PARTIALLY_UNDONE,
    });

    const result = await service.undoJob(jobId);

    expect(result.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
    expect(mockPrisma.customer.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'cust-clean' },
    });
    // cust-blocked is never deleted
    expect(mockPrisma.customer.deleteMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cust-blocked' }),
      }),
    );
  });

  it('skips unconfirmed conflict records, but reverts confirmed conflict records', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 1, update: 0 },
      options_json: {},
    });

    mockPrisma.importJobRow.findMany.mockResolvedValue([
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: 'cust-conflict',
        normalized_json: { first_name: 'Conflict' },
      },
    ]);

    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-conflict',
      tenant_id: tenantId,
      updatedAt: new Date(appliedAt.getTime() + 10000), // modified post-import
    });

    // 1. Without confirmation: skipped
    mockPrisma.importJob.update.mockResolvedValue({
      id: jobId,
      status: ImportJobStatus.PARTIALLY_UNDONE,
    });

    const unconfirmedResult = await service.undoJob(jobId);
    expect(unconfirmedResult.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
    expect(mockPrisma.customer.deleteMany).not.toHaveBeenCalled();

    // 2. With confirmation: deleted
    mockPrisma.importJob.update.mockResolvedValue({
      id: jobId,
      status: ImportJobStatus.UNDONE,
    });

    const confirmedResult = await service.undoJob(jobId, {
      confirmedEntityIds: ['cust-conflict'],
    });
    expect(confirmedResult.status).toBe(ImportJobStatus.UNDONE);
    expect(mockPrisma.customer.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'cust-conflict' },
    });
  });
});
