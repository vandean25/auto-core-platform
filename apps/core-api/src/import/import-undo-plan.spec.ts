import { ImportRowAction } from '@prisma/client';
import { planUndoRows } from './import-undo-plan.js';
import {
  UNDO_BLOCKED_REASONS,
  type UndoGuardPrismaClient,
} from './import-undo.types.js';

describe('planUndoRows', () => {
  const tenantId = 'tenant-1';
  const appliedAt = new Date('2026-10-30T10:00:00.000Z');

  const mockClient: UndoGuardPrismaClient = {
    customer: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicle: { findMany: jest.fn().mockResolvedValue([]) } as any,
    laborOperation: { findMany: jest.fn().mockResolvedValue([]) } as any,
    catalogItem: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleNotice: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleParty: { findMany: jest.fn().mockResolvedValue([]) } as any,
    invoice: { findMany: jest.fn().mockResolvedValue([]) } as any,
    workshopOrder: { findMany: jest.fn().mockResolvedValue([]) } as any,
    salesOrder: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleSale: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehiclePurchase: { findMany: jest.fn().mockResolvedValue([]) } as any,
    loanerBooking: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) } as any,
    workshopTaskLineItem: { findMany: jest.fn().mockResolvedValue([]) } as any,
    inventoryTransaction: { findMany: jest.fn().mockResolvedValue([]) } as any,
    invoiceItem: { findMany: jest.fn().mockResolvedValue([]) } as any,
    purchaseOrderItem: { findMany: jest.fn().mockResolvedValue([]) } as any,
    auditLog: { findMany: jest.fn().mockResolvedValue([]) } as any,
    customerConsent: { findMany: jest.fn().mockResolvedValue([]) } as any,
    customerContactPoint: { findMany: jest.fn().mockResolvedValue([]) } as any,
    legacyDocument: { findMany: jest.fn().mockResolvedValue([]) } as any,
    tyreSet: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleMedia: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleEquipmentSelection: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleEquipmentFreeTextItem: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleListing: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleValuationSnapshot: { findMany: jest.fn().mockResolvedValue([]) } as any,
    tyreMeasurement: { findMany: jest.fn().mockResolvedValue([]) } as any,
    vehicleInspectionRecord: { findMany: jest.fn().mockResolvedValue([]) } as any,
  };

  it('marks legacy rows without entity_id as LEGACY_JOB_NO_ENTITY_LINK instead of UNKNOWN', async () => {
    const rows = [
      {
        tenant_id: tenantId,
        import_job_id: 'job-1',
        row_no: 1,
        external_id: 'EXT-1',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors_json: null,
        warnings_json: null,
        normalized_json: { first_name: 'Legacy' },
        apply_seq: 1,
        before_snapshot_json: null,
        undone_at: null,
      },
    ];

    const plan = await planUndoRows(
      mockClient,
      {
        tenantId,
        entityType: 'CUSTOMER',
        appliedAt,
        confirmedEntityIds: new Set(),
      },
      rows,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBeNull();
    expect(plan[0].reason).toBe(UNDO_BLOCKED_REASONS.LEGACY_JOB_NO_ENTITY_LINK);
  });

  it('marks rows whose entity is missing from eligibility as ENTITY_NOT_FOUND', async () => {
    const rows = [
      {
        tenant_id: tenantId,
        import_job_id: 'job-1',
        row_no: 1,
        external_id: 'EXT-1',
        action: ImportRowAction.CREATE,
        entity_id: 'cust-missing',
        errors_json: null,
        warnings_json: null,
        normalized_json: { first_name: 'Missing' },
        apply_seq: 1,
        before_snapshot_json: null,
        undone_at: null,
      },
    ];

    const plan = await planUndoRows(
      mockClient,
      {
        tenantId,
        entityType: 'CUSTOMER',
        appliedAt,
        confirmedEntityIds: new Set(),
      },
      rows,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBeNull();
    expect(plan[0].reason).toBe(UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND);
  });
});
