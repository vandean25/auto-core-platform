import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { ImportUndoPreviewService } from './import-undo.preview.service.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';

const GUARD_MODELS = [
  'customer',
  'vehicle',
  'laborOperation',
  'catalogItem',
  'vehicleNotice',
  'vehicleParty',
  'invoice',
  'workshopOrder',
  'salesOrder',
  'vehicleSale',
  'vehiclePurchase',
  'loanerBooking',
  'vehicleLedgerEntry',
  'workshopTaskLineItem',
  'inventoryTransaction',
  'invoiceItem',
  'purchaseOrderItem',
  'auditLog',
  'customerConsent',
  'customerContactPoint',
  'legacyDocument',
  'tyreSet',
  'vehicleMedia',
  'vehicleEquipmentSelection',
  'vehicleEquipmentFreeTextItem',
  'vehicleListing',
  'vehicleValuationSnapshot',
  'tyreMeasurement',
  'vehicleInspectionRecord',
] as const;

describe('ImportUndoPreviewService', () => {
  const tenantId = 'tenant-123';
  const jobId = 'job-456';
  const appliedAt = new Date('2026-10-30T10:00:00.000Z');
  const beforeAppliedAt = new Date(appliedAt.getTime() - 1000);

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
        findFirst: jest.fn().mockResolvedValue({ row_no: 1 }),
      },
      catalogPriceHistory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cph-1' }),
      },
    };
    for (const model of GUARD_MODELS) {
      mockPrisma[model] = { findMany: jest.fn().mockResolvedValue([]) };
    }

    service = new ImportUndoPreviewService(mockTenantContext, mockPrisma);
  });

  function mockCustomers(
    customers: Array<{ id: string; updatedAt: Date }>,
  ): void {
    mockPrisma.customer.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) =>
        customers.filter((customer) => where.id.in.includes(customer.id)),
    );
  }

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

  it('throws ConflictException when job is not APPLIED or FAILED with applied rows', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      status: ImportJobStatus.DRY_RUN_DONE,
      totals_json: { create: 0, update: 0 },
    });

    await expect(service.previewUndo(jobId)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException with IMPORT_JOB_BUSY when job is APPLYING', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      status: ImportJobStatus.APPLYING,
      totals_json: { create: 1, update: 0 },
    });

    await expect(service.previewUndo(jobId)).rejects.toMatchObject({
      response: { code: 'IMPORT_JOB_BUSY' },
    });
  });

  it('throws BadRequestException when job is already UNDONE', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      status: ImportJobStatus.UNDONE,
      totals_json: { create: 1, update: 0 },
    });

    await expect(service.previewUndo(jobId)).rejects.toMatchObject({
      response: { code: 'IMPORT_JOB_ALREADY_UNDONE' },
    });
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

    mockCustomers([
      { id: 'cust-1', updatedAt: beforeAppliedAt },
      { id: 'cust-2', updatedAt: beforeAppliedAt },
    ]);

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
    // One batched eligibility lookup per page, never one query per row.
    expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledTimes(1);
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

    mockCustomers([
      { id: 'cust-blocked', updatedAt: beforeAppliedAt },
      { id: 'cust-conflict', updatedAt: new Date(appliedAt.getTime() + 5000) },
    ]);
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-99', customer_id: 'cust-blocked' },
    ]);

    const preview = await service.previewUndo(jobId);

    expect(preview.counts.blocked).toBe(1);
    expect(preview.counts.conflicts).toBe(1);
    expect(preview.counts.toDelete).toBe(0);
    expect(preview.blocked).toHaveLength(1);
    expect(preview.blocked[0].entityId).toBe('cust-blocked');
    expect(preview.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
    );
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0].entityId).toBe('cust-conflict');
    expect(preview.conflicts[0].reason).toBe(
      UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
    );
  });

  it('blocks a row whose entity is gone', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.APPLIED,
      appliedAt,
      totals_json: { create: 1, update: 0 },
    });
    mockPrisma.importJobRow.findMany
      .mockResolvedValueOnce([
        {
          row_no: 1,
          action: ImportRowAction.CREATE,
          entity_id: 'cust-gone',
          normalized_json: { first_name: 'Gone' },
        },
      ])
      .mockResolvedValueOnce([]);
    mockCustomers([]);

    const preview = await service.previewUndo(jobId);

    expect(preview.canUndo).toBe(false);
    expect(preview.counts.blocked).toBe(1);
    expect(preview.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
    );
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

  it('returns BLOCKED preview when the job expired', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValue({
      id: jobId,
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      status: ImportJobStatus.CANCELLED,
      appliedAt,
      totals_json: { create: 3, update: 0 },
      options_json: { cancel_reason: 'expired' },
    });

    await expect(service.previewUndo(jobId)).rejects.toMatchObject({
      response: { code: 'IMPORT_JOB_EXPIRED' },
    });
  });
});
