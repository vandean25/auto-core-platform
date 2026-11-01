import { TyreStorageService } from './tyre-storage.service.js';
import { TyreStorageClock } from './tyre-storage.clock.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../common/services/site-context.service.js';

describe('TyreStorageService', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const siteId = '00000000-0000-0000-0000-000000000002';
  const userId = '00000000-0000-0000-0000-000000000003';
  const customerId = '00000000-0000-0000-0000-000000000004';
  const locationId = '00000000-0000-0000-0000-000000000005';
  const setId = '00000000-0000-0000-0000-000000000006';

  let service: TyreStorageService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockSiteContext: any;
  let clock: TyreStorageClock;

  beforeEach(() => {
    clock = new TyreStorageClock();
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest
        .fn()
        .mockReturnValue({ userId, role: 'ADMIN' }),
      hasRole: jest.fn().mockReturnValue(true),
      isOfficeUser: jest.fn().mockReturnValue(true),
      getMembership: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    };
    mockSiteContext = {
      getSiteId: jest.fn().mockResolvedValue(siteId),
    };
    const storedTyreSets: any[] = [];
    mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (tx: any) => Promise<any>) =>
          cb(mockPrisma),
        ),
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: customerId }),
      },
      vehicle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      storageLocation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: locationId, site_id: siteId }),
      },
      tyreStorageSettings: {
        findUnique: jest.fn().mockResolvedValue({
          due_for_swap_days: 30,
          winter_swap_month: 10,
          winter_swap_day: 15,
          summer_swap_month: 4,
          summer_swap_day: 15,
        }),
        upsert: jest.fn().mockResolvedValue({
          due_for_swap_days: 30,
          winter_swap_month: 10,
          winter_swap_day: 15,
          summer_swap_month: 4,
          summer_swap_day: 15,
        }),
      },
      tyreSet: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = {
            id: setId,
            tenant_id: tenantId,
            site_id: siteId,
            customer_id: data.customer_id,
            vehicle_id: data.vehicle_id ?? null,
            location_id: data.location_id ?? null,
            label: data.label,
            season: data.season,
            tyre_count: data.tyre_count ?? 4,
            rim_type: data.rim_type ?? 'NONE',
            brand: data.brand ?? null,
            model: data.model ?? null,
            dimension: data.dimension ?? null,
            dot_codes: data.dot_codes ?? [],
            tread_depth_mm_json: data.tread_depth_mm_json ?? null,
            condition_notes: data.condition_notes ?? null,
            status: data.status,
            stored_since: data.stored_since ?? null,
            planned_swap_on: data.planned_swap_on ?? null,
            bin_label: data.bin_label ?? null,
            customer: {
              first_name: 'Max',
              last_name: 'Muster',
              phone: null,
              email: null,
            },
            vehicle: null,
            location: data.location_id ? { code: 'RACK-1' } : null,
            events: [],
          };
          storedTyreSets.push(row);
          return row;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          return (
            storedTyreSets.find(
              (s) =>
                (!where?.id || s.id === where.id) &&
                (!where?.tenant_id || s.tenant_id === where.tenant_id) &&
                (!where?.site_id || s.site_id === where.site_id),
            ) ?? null
          );
        }),
        updateMany: jest
          .fn()
          .mockImplementation(async ({ where, data }: any) => {
            const match = storedTyreSets.find(
              (s) =>
                s.id === where.id &&
                (where.status === undefined || s.status === where.status) &&
                (where.location_id === undefined ||
                  s.location_id === where.location_id),
            );
            if (!match) return { count: 0 };
            Object.assign(match, data);
            if (data.location_id !== undefined) {
              match.location = data.location_id ? { code: 'RACK-1' } : null;
            }
            return { count: 1 };
          }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          return storedTyreSets.filter(
            (s) =>
              (!where?.status || s.status === where.status) &&
              (!where?.tenant_id || s.tenant_id === where.tenant_id),
          );
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      tyreSetEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      tyreMeasurement: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    service = new TyreStorageService(
      mockPrisma,
      mockTenantContext,
      mockSiteContext,
      clock,
    );
  });

  describe('create', () => {
    it('sets status NEW and creates no check-in event when created without location', async () => {
      const result = await service.create({
        customerId,
        label: 'Summer Set',
        season: 'SUMMER',
      });

      expect(mockPrisma.tyreSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'NEW',
          location_id: null,
          stored_since: null,
        }),
      });
      expect(mockPrisma.tyreSetEvent.create).not.toHaveBeenCalled();
      expect(result.status).toBe('NEW');
      expect(result.locationId).toBeNull();
      const persisted = await mockPrisma.tyreSet.findFirst({
        where: { id: result.id },
      });
      expect(persisted?.status).toBe('NEW');
    });

    it('sets status IN_STORAGE and records a CHECK_IN event when location is supplied', async () => {
      const result = await service.create({
        customerId,
        label: 'Winter Set',
        season: 'WINTER',
        locationId,
        binLabel: 'B-1',
      });

      expect(mockPrisma.tyreSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'IN_STORAGE',
          location_id: locationId,
          stored_since: expect.any(Date),
        }),
      });
      expect(mockPrisma.tyreSetEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_type: 'CHECK_IN',
          to_location_id: locationId,
        }),
      });
      expect(result.status).toBe('IN_STORAGE');
      expect(result.locationId).toBe(locationId);
      const persisted = await mockPrisma.tyreSet.findFirst({
        where: { id: result.id },
      });
      expect(persisted?.status).toBe('IN_STORAGE');
    });
  });

  describe('checkIn and checkOut lifecycle', () => {
    it('checks in a NEW tyre set into storage', async () => {
      await service.create({
        customerId,
        label: 'Set 1',
        season: 'SUMMER',
      });

      const result = await service.checkIn(setId, { locationId });

      expect(mockPrisma.tyreSet.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: setId,
          status: 'NEW',
          location_id: null,
        }),
        data: expect.objectContaining({
          status: 'IN_STORAGE',
          location_id: locationId,
        }),
      });
      expect(mockPrisma.tyreSetEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_type: 'CHECK_IN',
          to_location_id: locationId,
        }),
      });
      expect(result.status).toBe('IN_STORAGE');
      expect(result.locationId).toBe(locationId);
      const persisted = await mockPrisma.tyreSet.findFirst({
        where: { id: setId },
      });
      expect(persisted?.status).toBe('IN_STORAGE');
    });

    it('checks out an IN_STORAGE tyre set resulting in ON_VEHICLE status', async () => {
      await service.create({
        customerId,
        label: 'Set 1',
        season: 'SUMMER',
        locationId,
      });

      const result = await service.checkOut(setId, {});

      expect(mockPrisma.tyreSet.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: setId,
          status: 'IN_STORAGE',
          location_id: locationId,
        }),
        data: expect.objectContaining({
          status: 'ON_VEHICLE',
          location_id: null,
        }),
      });
      expect(mockPrisma.tyreSetEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_type: 'CHECK_OUT',
          to_location_id: null,
        }),
      });
      expect(result.status).toBe('ON_VEHICLE');
      expect(result.locationId).toBeNull();
      const persisted = await mockPrisma.tyreSet.findFirst({
        where: { id: setId },
      });
      expect(persisted?.status).toBe('ON_VEHICLE');
    });
  });

  describe('listDueForSwap', () => {
    it('queries only IN_STORAGE sets, excluding NEW sets', async () => {
      mockPrisma.tyreSet.findMany.mockResolvedValue([]);

      await service.listDueForSwap();

      expect(mockPrisma.tyreSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'IN_STORAGE',
          }),
        }),
      );
    });
  });
});
