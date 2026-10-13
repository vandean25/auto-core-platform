import type { VehiclePersistenceService } from './vehicle-persistence.service.js';
import { VehiclePickerlDueService } from './vehicle-pickerl-due.service.js';

describe('VehiclePickerlDueService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const today = new Date('2026-10-13T12:00:00.000Z');
  let persistence: {
    findPickerlCandidates: jest.Mock;
    findOpenPickerlOrders: jest.Mock;
  };
  let service: VehiclePickerlDueService;

  const overdueVehicle = {
    id: 'vehicle-overdue',
    make: 'Audi',
    model: 'A4',
    plate: 'W-1',
    vin: null,
    inventory_role: 'CUSTOMER',
    first_registration_date: new Date('2015-03-01T00:00:00.000Z'),
    identity_resolution_generation: 'generation-1',
    identity_resolution_token: 'token-1',
    customer: null,
    inspection_records: [
      {
        inspected_on: new Date('2024-09-01T00:00:00.000Z'),
        plaketten_valid_until_year: 2025,
        plaketten_valid_until_month: 8,
      },
    ],
  };

  const unknownVehicle = {
    ...overdueVehicle,
    id: 'vehicle-unknown',
    first_registration_date: null,
    inspection_records: [],
  };

  beforeEach(() => {
    persistence = {
      findPickerlCandidates: jest.fn(),
      findOpenPickerlOrders: jest.fn(),
    };
    service = new VehiclePickerlDueService(
      persistence as unknown as VehiclePersistenceService,
    );
  });

  describe('listDue', () => {
    it('loads candidates through the tenant-scoped customer where clause', async () => {
      persistence.findPickerlCandidates.mockResolvedValue([]);

      await service.listDue({}, { tenantId, authorizedSiteIds: [siteId] }, today);

      expect(persistence.findPickerlCandidates).toHaveBeenCalledWith({
        tenant_id: tenantId,
        inventory_role: 'CUSTOMER',
      });
    });

    it('orders overdue vehicles before unknown ones and strips identity resolution state', async () => {
      persistence.findPickerlCandidates.mockResolvedValue([
        unknownVehicle,
        overdueVehicle,
      ]);

      const rows = await service.listDue(
        {},
        { tenantId, authorizedSiteIds: [siteId] },
        today,
      );

      expect(rows.map((row) => row.id)).toEqual([
        'vehicle-overdue',
        'vehicle-unknown',
      ]);
      expect(rows[0].pickerl_due.status).toBe('OVERDUE');
      expect(rows[0]).not.toHaveProperty('identity_resolution_generation');
      expect(rows[0]).not.toHaveProperty('identity_resolution_token');
    });

    it('keeps only rows matching the requested status', async () => {
      persistence.findPickerlCandidates.mockResolvedValue([
        unknownVehicle,
        overdueVehicle,
      ]);

      const rows = await service.listDue(
        { status: 'UNKNOWN' },
        { tenantId, authorizedSiteIds: [siteId] },
        today,
      );

      expect(rows.map((row) => row.id)).toEqual(['vehicle-unknown']);
    });
  });

  describe('findDuePage', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it('returns the requested page with the newest open order per vehicle', async () => {
      persistence.findOpenPickerlOrders.mockResolvedValue([
        { id: 'order-new', order_number: 'WO-2', vehicle_id: 'c' },
        { id: 'order-old', order_number: 'WO-1', vehicle_id: 'c' },
      ]);

      const result = await service.findDuePage(
        rows,
        { page: 2, pageSize: 2 },
        { tenantId, activeSiteId: siteId },
      );

      expect(persistence.findOpenPickerlOrders).toHaveBeenCalledWith(
        tenantId,
        siteId,
        ['c'],
      );
      expect(result).toEqual({
        data: [
          {
            id: 'c',
            open_pickerl_order: { id: 'order-new', order_number: 'WO-2' },
          },
        ],
        meta: { total: 3, page: 2, pageSize: 2, pageCount: 2 },
      });
    });

    it('does not look up open orders without an active site', async () => {
      const result = await service.findDuePage(
        rows,
        { page: 1, pageSize: 2 },
        { tenantId, activeSiteId: null },
      );

      expect(persistence.findOpenPickerlOrders).not.toHaveBeenCalled();
      expect(result.data).toEqual([
        { id: 'a', open_pickerl_order: null },
        { id: 'b', open_pickerl_order: null },
      ]);
    });

    it('does not look up open orders for an empty page', async () => {
      const result = await service.findDuePage(
        rows,
        { page: 5, pageSize: 2 },
        { tenantId, activeSiteId: siteId },
      );

      expect(persistence.findOpenPickerlOrders).not.toHaveBeenCalled();
      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({ total: 3, page: 5, pageSize: 2, pageCount: 2 });
    });
  });
});
