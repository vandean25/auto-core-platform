import { VehicleInventoryRole, VehicleStockStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';
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
      storageLocation: { findFirst: jest.fn() },
      customer: { findFirst: jest.fn() },
    };
    tenantContext = { getTenantId: jest.fn().mockResolvedValue(tenantId) };
    siteContext = { getSiteId: jest.fn().mockResolvedValue('site-1') };
    service = new VehicleStockQueryService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

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

    expect(result.data[0]).not.toHaveProperty('identity_resolution_generation');
    expect(result.data[0]).not.toHaveProperty('identity_resolution_token');
  });

  it('does not expose identity resolution state from stock detail vehicles', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'vehicle-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
      ledger_entries: [],
    });

    const result = await service.detail('vehicle-1');

    expect(result).not.toHaveProperty('identity_resolution_generation');
    expect(result).not.toHaveProperty('identity_resolution_token');
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
});
