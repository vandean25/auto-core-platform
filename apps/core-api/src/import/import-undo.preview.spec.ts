import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ImportEntityType, ImportJobStatus, ImportRowAction } from '@prisma/client';
import { ImportUndoPreviewService } from './import-undo.preview.service.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';

describe('ImportUndoPreviewService', () => {
  const tenantId = 'tenant-123';
  const jobId = 'job-456';
  const appliedAt = new Date('2026-10-30T10:00:00.000Z');

  let service: ImportUndoPreviewService;
  let mockTenantContext: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'admin-user',
        role: 'ADMIN',
      }),
    };

    mockPrisma = {
      importJob: {
        findFirst: jest.fn(),
      },
      importJobRow: {
        findMany: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
      },
      vehicle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      laborOperation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      catalogItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleNotice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleParty: {
        findFirst: jest.fn().mockResolvedValue(null),
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
      },
      customerConsent: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      customerContactPoint: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      legacyDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      tyreSet: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleMedia: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleEquipmentSelection: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleEquipmentFreeTextItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleListing: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleValuationSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      tyreMeasurement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      vehicleInspectionRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    service = new ImportUndoPreviewService(mockTenantContext, mockPrisma);
  });

  it('rejects with ForbiddenException for non-admin roles', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'tech-user',
      role: 'TECH',
    });

    await expect(service.previewUndo(jobId)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when job does not exist', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue(null);

    await expect(service.previewUndo(jobId)).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when job is not APPLIED or FAILED with applied rows', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      status: ImportJobStatus.DRY_RUN_DONE,
      totals_json: { create: 0, update: 0 },
    });

    await expect(service.previewUndo(jobId)).rejects.toThrow(BadRequestException);
  });

  it('generates preview for APPLIED customer job with clean create and update rows', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 1, update: 1 },
    });

    mockPrisma.importJobRow.findMany
      .mockResolvedValueOnce([
        {
          row_no: 1,
          action: ImportRowAction.CREATE,
          entity_id: 'cust-1',
          normalized_json: { first_name: 'Max', last_name: 'Muster' },
        },
        {
          row_no: 2,
          action: ImportRowAction.UPDATE,
          entity_id: 'cust-2',
          normalized_json: { first_name: 'Erika', last_name: 'Muster' },
          before_snapshot_json: { first_name: 'Erika', last_name: 'Alt' },
        },
      ])
      .mockResolvedValueOnce([]);

    mockPrisma.customer.findFirst
      .mockResolvedValueOnce({
        id: 'cust-1',
        first_name: 'Max',
        last_name: 'Muster',
        updatedAt: new Date(appliedAt.getTime() - 1000),
      })
      .mockResolvedValueOnce({
        id: 'cust-2',
        first_name: 'Erika',
        last_name: 'Muster',
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });

    const preview = await service.previewUndo(jobId);

    expect(preview.canUndo).toBe(true);
    expect(preview.counts.toDelete).toBe(1);
    expect(preview.counts.toRestore).toBe(1);
    expect(preview.counts.conflicts).toBe(0);
    expect(preview.counts.blocked).toBe(0);
    expect(preview.deletions).toHaveLength(1);
    expect(preview.deletions[0].entityId).toBe('cust-1');
    expect(preview.restorations).toHaveLength(1);
    expect(preview.restorations[0].entityId).toBe('cust-2');
  });

  it('correctly categorizes blocked customer with invoice and conflict customer with recent edit', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 2, update: 0 },
    });

    mockPrisma.importJobRow.findMany
      .mockResolvedValueOnce([
        {
          row_no: 1,
          action: ImportRowAction.CREATE,
          entity_id: 'cust-blocked',
          normalized_json: { first_name: 'Blocked', last_name: 'Customer' },
        },
        {
          row_no: 2,
          action: ImportRowAction.CREATE,
          entity_id: 'cust-conflict',
          normalized_json: { first_name: 'Conflict', last_name: 'Customer' },
        },
      ])
      .mockResolvedValueOnce([]);

    // cust-blocked has invoice
    mockPrisma.customer.findFirst
      .mockResolvedValueOnce({
        id: 'cust-blocked',
        first_name: 'Blocked',
        last_name: 'Customer',
        updatedAt: new Date(appliedAt.getTime() - 1000),
      })
      .mockResolvedValueOnce({
        id: 'cust-conflict',
        first_name: 'Conflict',
        last_name: 'Customer',
        updatedAt: new Date(appliedAt.getTime() + 5000), // modified after appliedAt
      });

    mockPrisma.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-99',
      invoice_number: 'RE-2026-99',
    });

    const preview = await service.previewUndo(jobId);

    expect(preview.counts.blocked).toBe(1);
    expect(preview.counts.conflicts).toBe(1);
    expect(preview.counts.toDelete).toBe(0);
    expect(preview.blocked).toHaveLength(1);
    expect(preview.blocked[0].entityId).toBe('cust-blocked');
    expect(preview.blocked[0].reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE);
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0].entityId).toBe('cust-conflict');
    expect(preview.conflicts[0].reason).toBe(UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT);
  });

  it('returns BLOCKED preview when job options has rows_purged: true', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 5, update: 0 },
      options_json: { rows_purged: true },
    });

    const preview = await service.previewUndo(jobId);

    expect(preview.canUndo).toBe(false);
    expect(preview.status).toBe('BLOCKED');
    expect(preview.counts.blocked).toBe(5);
    expect(preview.blocked).toHaveLength(1);
    expect(preview.blocked[0].reason).toBe(UNDO_BLOCKED_REASONS.ROWS_PURGED);
  });

  it('returns BLOCKED preview when applied job rows have been purged from database', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 3, update: 0 },
      options_json: {},
    });

    mockPrisma.importJobRow.findMany.mockResolvedValueOnce([]);

    const preview = await service.previewUndo(jobId);

    expect(preview.canUndo).toBe(false);
    expect(preview.status).toBe('BLOCKED');
    expect(preview.counts.blocked).toBe(3);
    expect(preview.blocked).toHaveLength(1);
    expect(preview.blocked[0].reason).toBe(UNDO_BLOCKED_REASONS.ROWS_PURGED);
  });
});
