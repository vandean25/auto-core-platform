import { checkEntitiesUndoEligibility } from './import-undo.guard.js';
import {
  UNDO_BLOCKED_REASONS,
  type UndoGuardPrismaClient,
} from './import-undo.types.js';

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

type GuardModel = (typeof GUARD_MODELS)[number];

type MockDelegate = { findMany: jest.Mock };

const TENANT_ID = 'tenant-test-1';
const APPLIED_AT = new Date('2026-10-30T10:00:00.000Z');
const BEFORE_APPLIED_AT = new Date(APPLIED_AT.getTime() - 1000);

function createMockClient(): UndoGuardPrismaClient {
  const client: Record<string, MockDelegate> = {};
  for (const model of GUARD_MODELS) {
    client[model] = { findMany: jest.fn().mockResolvedValue([]) };
  }
  return client as unknown as UndoGuardPrismaClient;
}

function delegateOf(client: UndoGuardPrismaClient, model: GuardModel) {
  return client[model] as unknown as MockDelegate;
}

function mockRows(
  client: UndoGuardPrismaClient,
  model: GuardModel,
  rows: Record<string, unknown>[],
): void {
  delegateOf(client, model).findMany.mockResolvedValue(rows);
}

function entity(overrides: Record<string, unknown> = {}) {
  return { updatedAt: BEFORE_APPLIED_AT, ...overrides };
}

describe('import-undo.guard', () => {
  let client: UndoGuardPrismaClient;

  beforeEach(() => {
    client = createMockClient();
  });

  async function checkCustomer(ids: string[] = ['cust-1']) {
    return checkEntitiesUndoEligibility(
      client,
      TENANT_ID,
      'CUSTOMER',
      ids,
      APPLIED_AT,
    );
  }

  function mockCustomer(overrides: Record<string, unknown> = {}) {
    mockRows(client, 'customer', [entity({ id: 'cust-1', ...overrides })]);
  }

  describe('Customer entity', () => {
    it('returns ELIGIBLE for untouched customer without downstream references', async () => {
      mockCustomer();

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('ELIGIBLE');
      expect(delegateOf(client, 'invoice').findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, customer_id: { in: ['cust-1'] } },
        select: { id: true, customer_id: true },
      });
      expect(
        delegateOf(client, 'workshopOrder').findMany,
      ).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          OR: [
            { customer_id: { in: ['cust-1'] } },
            { bill_to_customer_id: { in: ['cust-1'] } },
          ],
        },
        select: { id: true, customer_id: true, bill_to_customer_id: true },
      });
    });

    it('returns BLOCKED when customer has an invoice', async () => {
      mockCustomer();
      mockRows(client, 'invoice', [{ id: 'inv-1', customer_id: 'cust-1' }]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
      );
      expect(results.get('cust-1')?.references).toContain('invoice:inv-1');
    });

    it('returns BLOCKED when customer has a workshop order', async () => {
      mockCustomer();
      mockRows(client, 'workshopOrder', [{ id: 'wo-1', customer_id: 'cust-1' }]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      );
    });

    it('returns BLOCKED when customer is only referenced as bill-to', async () => {
      mockCustomer();
      mockRows(client, 'workshopOrder', [
        { id: 'wo-1', customer_id: null, bill_to_customer_id: 'cust-1' },
      ]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      );
    });

    it('returns BLOCKED when customer has a consent record', async () => {
      mockCustomer();
      mockRows(client, 'customerConsent', [
        { id: 'consent-1', customer_id: 'cust-1' },
      ]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONSENT,
      );
    });

    it('returns BLOCKED when customer has a contact point', async () => {
      mockCustomer();
      mockRows(client, 'customerContactPoint', [
        { id: 'cp-1', customer_id: 'cust-1' },
      ]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONTACT_POINT,
      );
    });

    it('returns BLOCKED when customer is linked to a vehicle', async () => {
      mockCustomer();
      mockRows(client, 'vehicle', [{ id: 'veh-1', customer_id: 'cust-1' }]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_VEHICLE,
      );
    });

    it('returns BLOCKED when customer is linked to a legacy document', async () => {
      mockCustomer();
      mockRows(client, 'legacyDocument', [
        { id: 'doc-1', customer_id: 'cust-1' },
      ]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('BLOCKED');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_LEGACY_DOCUMENT,
      );
    });

    it('keeps the first blocking reference when several exist', async () => {
      mockCustomer();
      mockRows(client, 'salesOrder', [{ id: 'so-1', customer_id: 'cust-1' }]);
      mockRows(client, 'vehicleSale', [{ id: 'vs-1', customer_id: 'cust-1' }]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_SALES_ORDER,
      );
      expect(results.get('cust-1')?.references).toEqual(['salesOrder:so-1']);
    });

    it('ignores references that belong to another customer', async () => {
      mockCustomer();
      mockRows(client, 'invoice', [{ id: 'inv-1', customer_id: 'cust-other' }]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('ELIGIBLE');
    });

    it('returns CONFLICT when customer updatedAt is newer than appliedAt', async () => {
      const laterDate = new Date(APPLIED_AT.getTime() + 10000);
      mockCustomer({ updatedAt: laterDate });

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('CONFLICT');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      );
      expect(results.get('cust-1')?.currentUpdatedAt).toEqual(laterDate);
    });

    it('returns CONFLICT when an audit log entry exists after appliedAt', async () => {
      const laterDate = new Date(APPLIED_AT.getTime() + 5000);
      mockCustomer({ updatedAt: APPLIED_AT });
      mockRows(client, 'auditLog', [
        { entity_id: 'cust-1', occurred_at: laterDate },
      ]);

      const results = await checkCustomer();

      expect(results.get('cust-1')?.status).toBe('CONFLICT');
      expect(results.get('cust-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      );
      expect(results.get('cust-1')?.currentUpdatedAt).toEqual(laterDate);
    });

    it('returns BLOCKED with ENTITY_NOT_FOUND for a missing customer', async () => {
      mockCustomer();

      const results = await checkCustomer(['cust-1', 'cust-missing']);

      expect(results.get('cust-1')?.status).toBe('ELIGIBLE');
      expect(results.get('cust-missing')?.status).toBe('BLOCKED');
      expect(results.get('cust-missing')?.reason).toBe(
        UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
      );
    });

    it('runs one query per reference table for a whole batch', async () => {
      mockRows(client, 'customer', [
        entity({ id: 'cust-1' }),
        entity({ id: 'cust-2' }),
        entity({ id: 'cust-3' }),
      ]);
      mockRows(client, 'invoice', [{ id: 'inv-1', customer_id: 'cust-2' }]);

      const results = await checkCustomer(['cust-1', 'cust-2', 'cust-3']);

      expect(results.get('cust-1')?.status).toBe('ELIGIBLE');
      expect(results.get('cust-2')?.status).toBe('BLOCKED');
      expect(results.get('cust-3')?.status).toBe('ELIGIBLE');
      expect(delegateOf(client, 'invoice').findMany).toHaveBeenCalledTimes(1);
      expect(delegateOf(client, 'invoice').findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          customer_id: { in: ['cust-1', 'cust-2', 'cust-3'] },
        },
        select: { id: true, customer_id: true },
      });
    });

    it('skips every query when no entity id is given', async () => {
      const results = await checkCustomer([]);

      expect(results.size).toBe(0);
      expect(delegateOf(client, 'customer').findMany).not.toHaveBeenCalled();
      expect(delegateOf(client, 'invoice').findMany).not.toHaveBeenCalled();
    });
  });

  describe('Vehicle entity', () => {
    async function checkVehicle() {
      return checkEntitiesUndoEligibility(
        client,
        TENANT_ID,
        'VEHICLE',
        ['veh-1'],
        APPLIED_AT,
      );
    }

    function mockVehicle(overrides: Record<string, unknown> = {}) {
      mockRows(client, 'vehicle', [entity({ id: 'veh-1', ...overrides })]);
    }

    it('returns ELIGIBLE for untouched vehicle', async () => {
      mockVehicle();

      const results = await checkVehicle();

      expect(results.get('veh-1')?.status).toBe('ELIGIBLE');
    });

    it.each([
      ['vehicleLedgerEntry', UNDO_BLOCKED_REASONS.DOWNSTREAM_STOCK_MOVEMENT],
      ['vehicleMedia', UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_MEDIA],
      ['vehicleParty', UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PARTY],
      ['vehicleNotice', UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_NOTICE],
      ['tyreSet', UNDO_BLOCKED_REASONS.DOWNSTREAM_TYRE_RECORD],
      [
        'vehicleInspectionRecord',
        UNDO_BLOCKED_REASONS.DOWNSTREAM_INSPECTION_RECORD,
      ],
    ] as const)(
      'returns BLOCKED when %s references the vehicle',
      async (model, reason) => {
        mockVehicle();
        mockRows(client, model, [{ id: 'ref-1', vehicle_id: 'veh-1' }]);

        const results = await checkVehicle();

        expect(results.get('veh-1')?.status).toBe('BLOCKED');
        expect(results.get('veh-1')?.reason).toBe(reason);
      },
    );
  });

  describe('Labor operation entity', () => {
    it('returns BLOCKED when referenced by a workshop task line item', async () => {
      mockRows(client, 'laborOperation', [entity({ id: 'lo-1' })]);
      mockRows(client, 'workshopTaskLineItem', [
        { id: 'wtli-1', labor_operation_id: 'lo-1' },
      ]);

      const results = await checkEntitiesUndoEligibility(
        client,
        TENANT_ID,
        'LABOR_OPERATION',
        ['lo-1'],
        APPLIED_AT,
      );

      expect(results.get('lo-1')?.status).toBe('BLOCKED');
      expect(results.get('lo-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      );
    });
  });

  describe('Catalog item entity', () => {
    it('returns BLOCKED when an invoice item references the catalog item', async () => {
      mockRows(client, 'catalogItem', [entity({ id: 'ci-1' })]);
      mockRows(client, 'invoiceItem', [
        { id: 'ii-1', catalog_item_id: 'ci-1' },
      ]);

      const results = await checkEntitiesUndoEligibility(
        client,
        TENANT_ID,
        'CATALOG_ITEM',
        ['ci-1'],
        APPLIED_AT,
      );

      expect(results.get('ci-1')?.status).toBe('BLOCKED');
      expect(results.get('ci-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
      );
    });
  });

  describe('Vehicle notice entity', () => {
    it('returns BLOCKED when the notice is resolved by a workshop order', async () => {
      mockRows(client, 'vehicleNotice', [
        entity({ id: 'notice-1', resolved_workshop_order_id: 'wo-9' }),
      ]);

      const results = await checkEntitiesUndoEligibility(
        client,
        TENANT_ID,
        'VEHICLE_NOTICE',
        ['notice-1'],
        APPLIED_AT,
      );

      expect(results.get('notice-1')?.status).toBe('BLOCKED');
      expect(results.get('notice-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      );
      expect(results.get('notice-1')?.references).toContain(
        'workshopOrder:wo-9',
      );
    });
  });

  describe('Financial / Document entity types', () => {
    it('returns BLOCKED unconditionally for LEGACY_INVOICE', async () => {
      const results = await checkEntitiesUndoEligibility(
        client,
        TENANT_ID,
        'LEGACY_INVOICE',
        ['inv-1'],
        APPLIED_AT,
      );

      expect(results.get('inv-1')?.status).toBe('BLOCKED');
      expect(results.get('inv-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.FINANCIAL_IMPORT_CANNOT_BE_UNDONE,
      );
      expect(delegateOf(client, 'invoice').findMany).not.toHaveBeenCalled();
    });
  });

  describe('Unknown entity types', () => {
    it('returns BLOCKED unconditionally (fails closed)', async () => {
      const results = await checkEntitiesUndoEligibility(
        client,
        TENANT_ID,
        'UNKNOWN_FUTURE_ENTITY',
        ['id-1'],
        APPLIED_AT,
      );

      expect(results.get('id-1')?.status).toBe('BLOCKED');
      expect(results.get('id-1')?.reason).toBe(
        UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE,
      );
    });
  });
});
