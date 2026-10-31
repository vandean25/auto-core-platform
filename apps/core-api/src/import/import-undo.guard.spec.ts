import { checkEntityUndoEligibility } from './import-undo.guard.js';
import {
  UNDO_BLOCKED_REASONS,
  type UndoGuardPrismaClient,
} from './import-undo.types.js';

describe('import-undo.guard', () => {
  const tenantId = 'tenant-test-1';
  const appliedAt = new Date('2026-10-30T10:00:00.000Z');

  let mockClient: UndoGuardPrismaClient;

  beforeEach(() => {
    mockClient = {
      customer: {
        findFirst: jest.fn(),
      } as unknown as UndoGuardPrismaClient['customer'],
      vehicle: {
        findFirst: jest.fn(),
      } as unknown as UndoGuardPrismaClient['vehicle'],
      laborOperation: {
        findFirst: jest.fn(),
      } as unknown as UndoGuardPrismaClient['laborOperation'],
      catalogItem: {
        findFirst: jest.fn(),
      } as unknown as UndoGuardPrismaClient['catalogItem'],
      vehicleNotice: {
        findFirst: jest.fn(),
      } as unknown as UndoGuardPrismaClient['vehicleNotice'],
      vehicleParty: {
        findFirst: jest.fn(),
      } as unknown as UndoGuardPrismaClient['vehicleParty'],
      salesOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['salesOrder'],
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['workshopOrder'],
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['invoice'],
      vehicleSale: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleSale'],
      vehiclePurchase: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehiclePurchase'],
      loanerBooking: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['loanerBooking'],
      vehicleLedgerEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleLedgerEntry'],
      workshopTaskLineItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['workshopTaskLineItem'],
      inventoryTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['inventoryTransaction'],
      invoiceItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['invoiceItem'],
      purchaseOrderItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['purchaseOrderItem'],
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['auditLog'],
      customerConsent: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['customerConsent'],
      customerContactPoint: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['customerContactPoint'],
      legacyDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['legacyDocument'],
      tyreSet: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['tyreSet'],
      vehicleMedia: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleMedia'],
      vehicleEquipmentSelection: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleEquipmentSelection'],
      vehicleEquipmentFreeTextItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleEquipmentFreeTextItem'],
      vehicleListing: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleListing'],
      vehicleValuationSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleValuationSnapshot'],
      tyreMeasurement: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['tyreMeasurement'],
      vehicleInspectionRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
      } as unknown as UndoGuardPrismaClient['vehicleInspectionRecord'],
    };
  });

  describe('Customer entity', () => {
    it('returns ELIGIBLE for untouched customer without downstream references', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('ELIGIBLE');
      expect(mockClient.invoice.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, customer_id: 'cust-1' },
      });
      expect(mockClient.workshopOrder.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          OR: [{ customer_id: 'cust-1' }, { bill_to_customer_id: 'cust-1' }],
        },
      });
    });

    it('returns BLOCKED when customer has an invoice', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        invoice_number: 'RE-2026-001',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE);
      expect(result.references).toContain('invoice:inv-1');
    });

    it('returns BLOCKED when customer has a workshop order', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.workshopOrder.findFirst as jest.Mock).mockResolvedValue({
        id: 'wo-1',
        order_number: 'WO-2026-001',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER);
    });

    it('returns BLOCKED when customer has a consent record', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.customerConsent.findFirst as jest.Mock).mockResolvedValue({
        id: 'consent-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONSENT);
    });

    it('returns BLOCKED when customer has a contact point', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.customerContactPoint.findFirst as jest.Mock).mockResolvedValue({
        id: 'cp-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONTACT_POINT);
    });

    it('returns BLOCKED when customer is linked to a vehicle', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.vehicle.findFirst as jest.Mock).mockResolvedValue({
        id: 'veh-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_VEHICLE);
    });

    it('returns BLOCKED when customer is linked to a legacy document', async () => {
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.legacyDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'doc-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_LEGACY_DOCUMENT);
    });

    it('returns CONFLICT when customer updatedAt is newer than appliedAt without references', async () => {
      const laterDate = new Date(appliedAt.getTime() + 10000);
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: laterDate,
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('CONFLICT');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT);
      expect(result.currentUpdatedAt).toEqual(laterDate);
    });

    it('returns CONFLICT when an audit log entry exists after appliedAt', async () => {
      const laterDate = new Date(appliedAt.getTime() + 5000);
      (mockClient.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime()),
      });
      (mockClient.auditLog.findFirst as jest.Mock).mockResolvedValue({
        id: 'audit-1',
        actor_email: 'admin@example.com',
        occurred_at: laterDate,
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'CUSTOMER',
        'cust-1',
        appliedAt,
      );

      expect(result.status).toBe('CONFLICT');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT);
      expect(result.currentUpdatedAt).toEqual(laterDate);
    });
  });

  describe('Vehicle entity', () => {
    it('returns ELIGIBLE for untouched vehicle', async () => {
      (mockClient.vehicle.findFirst as jest.Mock).mockResolvedValue({
        id: 'veh-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'VEHICLE',
        'veh-1',
        appliedAt,
      );

      expect(result.status).toBe('ELIGIBLE');
    });

    it('returns BLOCKED when vehicle has vehicle ledger entries', async () => {
      (mockClient.vehicle.findFirst as jest.Mock).mockResolvedValue({
        id: 'veh-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.vehicleLedgerEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'vle-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'VEHICLE',
        'veh-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_STOCK_MOVEMENT);
    });

    it('returns BLOCKED when vehicle has media', async () => {
      (mockClient.vehicle.findFirst as jest.Mock).mockResolvedValue({
        id: 'veh-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.vehicleMedia.findFirst as jest.Mock).mockResolvedValue({
        id: 'media-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'VEHICLE',
        'veh-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_MEDIA);
    });

    it('returns BLOCKED when vehicle has a party record', async () => {
      (mockClient.vehicle.findFirst as jest.Mock).mockResolvedValue({
        id: 'veh-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.vehicleParty.findFirst as jest.Mock).mockResolvedValue({
        id: 'party-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'VEHICLE',
        'veh-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PARTY);
    });

    it('returns BLOCKED when vehicle has a notice record', async () => {
      (mockClient.vehicle.findFirst as jest.Mock).mockResolvedValue({
        id: 'veh-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (mockClient.vehicleNotice.findFirst as jest.Mock).mockResolvedValue({
        id: 'notice-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'VEHICLE',
        'veh-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_NOTICE);
    });
  });

  describe('Labor operation entity', () => {
    it('returns BLOCKED when labor operation is referenced in workshop task line items', async () => {
      (mockClient.laborOperation.findFirst as jest.Mock).mockResolvedValue({
        id: 'lo-1',
        tenant_id: tenantId,
        updatedAt: new Date(appliedAt.getTime() - 1000),
      });
      (
        mockClient.workshopTaskLineItem.findFirst as jest.Mock
      ).mockResolvedValue({
        id: 'wtli-1',
      });

      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'LABOR_OPERATION',
        'lo-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER);
    });
  });

  describe('Financial / Document entity types', () => {
    it('returns BLOCKED unconditionally for LEGACY_INVOICE', async () => {
      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'LEGACY_INVOICE',
        'inv-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.FINANCIAL_IMPORT_CANNOT_BE_UNDONE);
    });
  });

  describe('Unknown entity types', () => {
    it('returns BLOCKED unconditionally for unknown entity type (fails closed)', async () => {
      const result = await checkEntityUndoEligibility(
        mockClient,
        tenantId,
        'UNKNOWN_FUTURE_ENTITY',
        'id-1',
        appliedAt,
      );

      expect(result.status).toBe('BLOCKED');
      expect(result.reason).toBe(UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE);
    });
  });
});
