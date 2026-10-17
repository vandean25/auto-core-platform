import { NotFoundException } from '@nestjs/common';
import { VehicleListingExportState } from '@prisma/client';
import { McpListingReadService } from './mcp-listing-read.service.js';

describe('McpListingReadService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const vehicleId = 'vehicle-1';

  const makeService = () => {
    const prisma = {
      vehicle: { findFirst: jest.fn() },
      vehiclePurchase: { findFirst: jest.fn() },
      vehicleListing: { findFirst: jest.fn(), findMany: jest.fn() },
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

  it('returns current stock-cycle listing and pending removal from another cycle', async () => {
    const { service, prisma } = makeService();
    prisma.vehicle.findFirst.mockResolvedValue({ id: vehicleId });
    prisma.vehiclePurchase.findFirst.mockResolvedValue({ id: 'purchase-2' });
    prisma.vehicleListing.findFirst.mockResolvedValue({
      id: 'listing-current',
      listing_ref: 'Lcurrent',
      stock_purchase_id: 'purchase-2',
      site_id: siteId,
      revision: 2,
      updatedAt: new Date('2026-10-10'),
      channels: [],
    });
    prisma.vehicleListing.findMany.mockResolvedValue([
      {
        id: 'listing-old',
        listing_ref: 'Lold',
        stock_purchase_id: 'purchase-1',
        site_id: 'site-orig',
        revision: 5,
        updatedAt: new Date('2026-09-01'),
        channels: [
          {
            platform: 'MOBILE_DE',
            desired_state: 'INACTIVE',
            export_state: VehicleListingExportState.REMOVAL_REQUIRED,
            remote_state: 'UNKNOWN',
            serializer_profile: 'MOBILE_DE_REFERENCE_V1',
            last_export_at: null,
            removal_revision: 1,
          },
        ],
      },
    ]);

    const result = await service.getVehicleListingStatus({
      vehicle_id: vehicleId,
    });

    expect(result.listings).toHaveLength(2);
    expect(result.listings[0].listing_id).toBe('listing-current');
    expect(result.listings[1].listing_id).toBe('listing-old');
    expect(prisma.vehicleListing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          stock_purchase_id: 'purchase-2',
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
