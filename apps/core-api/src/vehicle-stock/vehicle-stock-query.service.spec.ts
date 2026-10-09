import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  VehicleInventoryRole,
  VehiclePurchaseStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  buildPatchUpdateData,
  buildVehicleListWhere,
  DEALER_INVENTORY_ROLES,
  mapDraftVehiclePurchase,
  mapStockVehicle,
  validatePatchTransitions,
  VehicleStockQueryService,
} from './vehicle-stock-query.service.js';
import type { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto.js';

describe('VehicleStockQueryService', () => {
  const tenantId = 'tenant-1';
  let service: VehicleStockQueryService;
  let prisma: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    vehicle: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    vehiclePurchase: { count: jest.Mock; findMany: jest.Mock };
    storageLocation: { findFirst: jest.Mock };
    customer: { findFirst: jest.Mock };
  };
  let tenantContext: { getTenantId: jest.Mock };
  let siteContext: { getSiteId: jest.Mock };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'site-1', is_active: true }]),
      $transaction: jest.fn(
        async (callback: (tx: PrismaService) => Promise<unknown>) =>
          callback(prisma as unknown as PrismaService),
      ),
      vehicle: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      vehiclePurchase: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      storageLocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'loc-1' }),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
      },
    };
    tenantContext = { getTenantId: jest.fn().mockResolvedValue(tenantId) };
    siteContext = { getSiteId: jest.fn().mockResolvedValue('site-1') };
    service = new VehicleStockQueryService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

  describe('list', () => {
    it('does not expose identity resolution state from stock list vehicles', async () => {
      prisma.vehicle.count.mockResolvedValue(1);
      prisma.vehiclePurchase.count.mockResolvedValue(0);
      prisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'vehicle-1',
          identity_resolution_generation: 'generation-1',
          identity_resolution_token: 'token-1',
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.IN_STOCK,
          reserved_for_customer: null,
          location: null,
        },
      ]);

      const result = await service.list({});

      expect(result.data[0]).not.toHaveProperty(
        'identity_resolution_generation',
      );
      expect(result.data[0]).not.toHaveProperty('identity_resolution_token');
    });

    it('includes draft purchases when no status or ON_ORDER is queried', async () => {
      prisma.vehicle.count.mockResolvedValue(1);
      prisma.vehiclePurchase.count.mockResolvedValue(1);
      prisma.vehiclePurchase.findMany.mockResolvedValue([
        {
          id: 'purchase-1',
          make: 'BMW',
          model: '320d',
          year: 2020,
          vin: 'VIN123',
          plate: 'ZG-1234',
          color: 'Black',
          mileage: 50000,
          updatedAt: new Date(),
        },
      ]);
      prisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'vehicle-1',
          make: 'Audi',
          model: 'A4',
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.IN_STOCK,
        },
      ]);

      const result = await service.list({ page: 1, limit: 10 });

      expect(result.meta.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({
        id: 'purchase-1',
        draft_purchase_id: 'purchase-1',
        stock_status: VehicleStockStatus.ON_ORDER,
      });
      expect(result.data[1]).toMatchObject({
        id: 'vehicle-1',
        draft_purchase_id: null,
      });
    });

    it('limits persisted stock vehicles to the active site lot', async () => {
      prisma.vehicle.count.mockResolvedValue(0);
      prisma.vehiclePurchase.count.mockResolvedValue(0);
      prisma.vehicle.findMany.mockResolvedValue([]);

      await service.list({});

      expect(prisma.vehicle.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          location: { site_id: 'site-1' },
        }),
      });
    });
  });

  describe('detail', () => {
    it('does not expose identity resolution state from stock detail vehicles', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: 'vehicle-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: 'token-1',
        ledger_entries: [],
        sales: [],
      });

      const result = await service.detail('vehicle-1');

      expect(result).not.toHaveProperty('identity_resolution_generation');
      expect(result).not.toHaveProperty('identity_resolution_token');
    });

    it('does not expose Kaufvertrag archive internals of nested sales', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: 'vehicle-1',
        ledger_entries: [],
        sales: [
          {
            id: 'sale-1',
            kaufvertrag_snapshot: { seller: { name: 'Demo Autohaus GmbH' } },
            kaufvertrag_snapshot_sha256: 'a'.repeat(64),
            kaufvertrag_archive_bucket: 'pdf-archive-bucket',
            kaufvertrag_archive_key:
              'vehicle-sale-kaufvertrag-archives/tenant-1/sale-1/aaaa/kaufvertrag-brand-v1.pdf',
            kaufvertrag_archive_generation: '101',
            kaufvertrag_archive_sha256: 'b'.repeat(64),
            kaufvertrag_generated_at: new Date('2026-10-09T10:00:00.000Z'),
            kaufvertrag_generation_error: null,
          },
        ],
      });

      const result = await service.detail('vehicle-1');

      expect(result.sales).toEqual([
        {
          id: 'sale-1',
          kaufvertrag_generated_at: new Date('2026-10-09T10:00:00.000Z'),
          kaufvertrag_generation_error: null,
        },
      ]);
    });

    it('throws NotFoundException when vehicle not found', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.detail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('limits nested sales to the current tenant and active site', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: 'vehicle-1',
        ledger_entries: [],
        sales: [],
      });

      await service.detail('vehicle-1');

      expect(prisma.vehicle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            sales: expect.objectContaining({
              where: { tenant_id: tenantId, site_id: 'site-1' },
            }),
          }),
        }),
      );
    });

    it('limits stock detail lookup to the active site lot', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.detail('vehicle-1')).rejects.toBeDefined();

      expect(prisma.vehicle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'vehicle-1',
            tenant_id: tenantId,
            location: { site_id: 'site-1' },
          },
        }),
      );
    });
  });

  describe('patch', () => {
    it('guards a lot change with the expected current location', async () => {
      prisma.vehicle.findFirst
        .mockResolvedValueOnce({
          id: 'vehicle-1',
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.IN_STOCK,
          location_id: 'lot-current',
          location: { id: 'lot-current', site_id: 'site-1' },
        })
        .mockResolvedValueOnce({
          id: 'vehicle-1',
          ledger_entries: [],
        sales: [],
        });
      prisma.storageLocation.findFirst.mockResolvedValue({ id: 'lot-next' });
      prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

      const moveRequest: PatchVehicleStockDto & {
        expectedLocationId: string;
      } = {
        location_id: 'lot-next',
        expectedLocationId: 'lot-current',
      };

      await service.patch('vehicle-1', moveRequest);

      expect(prisma.vehicle.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            location_id: 'lot-current',
            stock_status: {
              in: [
                VehicleStockStatus.IN_STOCK,
                VehicleStockStatus.RESERVED,
                VehicleStockStatus.IN_PREP,
              ],
            },
          }),
        }),
      );
    });

    it('rejects a null vehicle lot update', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: 'vehicle-1',
        inventory_role: VehicleInventoryRole.USED,
        stock_status: VehicleStockStatus.IN_STOCK,
        location_id: 'lot-current',
        location: { id: 'lot-current', site_id: 'site-1' },
      });

      await expect(
        service.patch('vehicle-1', { location_id: null }),
      ).rejects.toThrow('must have a vehicle lot');
      expect(prisma.vehicle.updateMany).not.toHaveBeenCalled();
    });

    it('does not patch a dealer vehicle outside the active site', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(
        service.patch('vehicle-1', { mileage: 10 }),
      ).rejects.toBeDefined();
      expect(prisma.vehicle.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when vehicle does not exist', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.patch('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when vehicle is not USED', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: 'v-1',
        inventory_role: VehicleInventoryRole.CUSTOMER,
      });

      await expect(service.patch('v-1', {})).rejects.toThrow(ConflictException);
    });

    it('updates vehicle and returns detail on success', async () => {
      prisma.vehicle.findFirst
        .mockResolvedValueOnce({
          id: 'v-1',
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.IN_STOCK,
        })
        .mockResolvedValueOnce({
          id: 'v-1',
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.RESERVED,
          ledger_entries: [],
        sales: [],
        });
      prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.patch('v-1', {
        color: 'Red',
        reserved_for_customer_id: 'cust-1',
      });

      expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'v-1',
          tenant_id: tenantId,
          inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
          stock_status: {
            in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
          },
        },
        data: expect.objectContaining({
          color: 'Red',
          reserved_for_customer_id: 'cust-1',
          stock_status: VehicleStockStatus.RESERVED,
        }),
      });
      expect(result).toBeDefined();
    });

    it('throws ConflictException when concurrent update fails', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: 'v-1',
        inventory_role: VehicleInventoryRole.USED,
        stock_status: VehicleStockStatus.IN_STOCK,
      });
      prisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.patch('v-1', { color: 'Blue' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('standalone helpers', () => {
    it('buildVehicleListWhere builds correct filters with search and status', () => {
      const { vehicleWhere, draftWhere } = buildVehicleListWhere(
        'tenant-1',
        'site-1',
        VehicleStockStatus.IN_STOCK,
        'query',
      );

      expect(vehicleWhere.tenant_id).toBe('tenant-1');
      expect(vehicleWhere.location).toEqual({ site_id: 'site-1' });
      expect(vehicleWhere.stock_status).toBe(VehicleStockStatus.IN_STOCK);
      expect(vehicleWhere.OR).toBeDefined();
      expect(draftWhere.tenant_id).toBe('tenant-1');
      expect(draftWhere.site_id).toBe('site-1');
      expect(draftWhere.status).toBe(VehiclePurchaseStatus.DRAFT);
      expect(draftWhere.OR).toBeDefined();
    });

    it('mapDraftVehiclePurchase maps all fields correctly', () => {
      const purchase = {
        id: 'p-1',
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: 'WVW123',
        plate: 'ZG-5555',
        color: 'Grey',
        mileage: 30000,
        updatedAt: new Date('2026-01-01'),
      };

      const mapped = mapDraftVehiclePurchase(purchase as any);
      expect(mapped).toEqual({
        id: 'p-1',
        draft_purchase_id: 'p-1',
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: 'WVW123',
        plate: 'ZG-5555',
        color: 'Grey',
        stock_status: VehicleStockStatus.ON_ORDER,
        inventory_role: VehicleInventoryRole.USED,
        mileage: 30000,
        location: null,
        reserved_for_customer: null,
        updatedAt: purchase.updatedAt,
      });
    });

    it('mapStockVehicle strips identity resolution state and sets draft_purchase_id to null', () => {
      const vehicle = {
        id: 'v-1',
        make: 'VW',
        identity_resolution_generation: 'gen-1',
        identity_resolution_token: 'tok-1',
      };

      const mapped = mapStockVehicle(vehicle as any);
      expect(mapped).toEqual({
        id: 'v-1',
        make: 'VW',
        draft_purchase_id: null,
      });
    });

    it('validatePatchTransitions validates used role and existence', () => {
      expect(() => validatePatchTransitions(null, 'v-1')).toThrow(
        NotFoundException,
      );
      expect(() =>
        validatePatchTransitions(
          {
            inventory_role: VehicleInventoryRole.CUSTOMER,
            stock_status: VehicleStockStatus.IN_STOCK,
          },
          'v-1',
        ),
      ).toThrow(ConflictException);
      expect(() =>
        validatePatchTransitions(
          {
            inventory_role: VehicleInventoryRole.USED,
            stock_status: VehicleStockStatus.IN_STOCK,
          },
          'v-1',
        ),
      ).not.toThrow();
    });

    it('buildPatchUpdateData transitions RESERVED to IN_STOCK when unreserving', () => {
      const result = buildPatchUpdateData(
        'v-1',
        't-1',
        { stock_status: VehicleStockStatus.RESERVED },
        { reserved_for_customer_id: null },
      );

      expect(result.data.reserved_for_customer_id).toBeNull();
      expect(result.data.stock_status).toBe(VehicleStockStatus.IN_STOCK);
      expect(result.where.stock_status).toBe(VehicleStockStatus.RESERVED);
    });
  });
});
