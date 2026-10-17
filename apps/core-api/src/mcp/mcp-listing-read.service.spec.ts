import { NotFoundException } from '@nestjs/common';
import { McpListingReadService } from './mcp-listing-read.service.js';

describe('McpListingReadService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const vehicleId = 'vehicle-1';

  const makeService = () => {
    const prisma = {
      vehicle: { findFirst: jest.fn() },
      vehicleListing: { findFirst: jest.fn() },
    };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
    };
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue(siteId),
    };
    const service = new McpListingReadService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );
    return { service, prisma };
  };

  it('returns listing status for the active site', async () => {
    const { service, prisma } = makeService();
    prisma.vehicle.findFirst.mockResolvedValue({ id: vehicleId });
    prisma.vehicleListing.findFirst.mockResolvedValue({
      id: 'listing-1',
      listing_ref: 'Lref',
      stock_purchase_id: 'purchase-1',
      revision: 1,
      channels: [],
    });

    const result = await service.getVehicleListingStatus({
      vehicle_id: vehicleId,
    });

    expect(result.vehicle_id).toBe(vehicleId);
    expect(prisma.vehicleListing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
        },
      }),
    );
  });

  it('throws when the vehicle is unknown in the tenant', async () => {
    const { service, prisma } = makeService();
    prisma.vehicle.findFirst.mockResolvedValue(null);
    await expect(
      service.getVehicleListingStatus({ vehicle_id: vehicleId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
