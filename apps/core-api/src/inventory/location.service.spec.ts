import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LocationService } from './location.service.js';

describe('LocationService', () => {
  it('lists only locations owned by the active site', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new LocationService(
      {
        storageLocation: { findMany },
      } as never,
      {
        getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      } as never,
      {
        getSiteId: jest.fn().mockResolvedValue('site-wien'),
      } as never,
    );

    await service.findAll();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: 'tenant-1',
          site_id: 'site-wien',
          is_system: false,
          deletedAt: null,
        },
      }),
    );
  });

  it('rejects deleting a frozen destination bin with outstanding shipped quantity', async () => {
    const destinationLocationId = 'destination-bin';
    const location = {
      id: destinationLocationId,
      is_system: false,
      _count: { children: 0, stocks: 0 },
    };
    const findLocation = jest
      .fn()
      .mockResolvedValueOnce(location)
      .mockResolvedValueOnce(location);
    const findTransferLines = jest.fn().mockImplementation(
      (query: {
        where: {
          OR?: Array<{
            to_site_id?: string;
            dest_location_id?: string;
          }>;
        };
      }) => {
        const queriesActiveDestinationSite = query.where.OR?.some(
          (clause) =>
            clause.to_site_id === 'site-wien' &&
            clause.dest_location_id === destinationLocationId,
        );

        return Promise.resolve(
          queriesActiveDestinationSite
            ? [
                {
                  source_location_id: 'source-bin',
                  dest_location_id: destinationLocationId,
                  approved_qty: new Prisma.Decimal(5),
                  shipped_qty: new Prisma.Decimal(5),
                  received_qty: new Prisma.Decimal(2),
                  returned_qty: new Prisma.Decimal(1),
                },
              ]
            : [],
        );
      },
    );
    const service = new LocationService(
      {
        storageLocation: {
          findFirst: findLocation,
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        vehicle: { count: jest.fn().mockResolvedValue(0) },
        stockTransferLine: { findMany: findTransferLines },
      } as never,
      {
        getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      } as never,
      {
        getSiteId: jest.fn().mockResolvedValue('site-wien'),
      } as never,
    );

    await expect(service.remove(destinationLocationId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
