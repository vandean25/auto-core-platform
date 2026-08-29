import { VehicleInventoryRole, VehicleStockStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleStockQueryService } from './vehicle-stock-query.service';

describe('VehicleStockQueryService', () => {
  const tenantId = 'tenant-1';
  let service: VehicleStockQueryService;
  let prisma: {
    vehicle: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    vehiclePurchase: { count: jest.Mock; findMany: jest.Mock };
  };
  let tenantContext: { getTenantId: jest.Mock };

  beforeEach(() => {
    prisma = {
      vehicle: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      vehiclePurchase: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    tenantContext = { getTenantId: jest.fn().mockResolvedValue(tenantId) };
    service = new VehicleStockQueryService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
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
});