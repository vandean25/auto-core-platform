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

  it('rejects deletion after a concurrent transfer freezes the destination bin', async () => {
    const destinationLocationId = 'destination-bin';
    const location = {
      id: destinationLocationId,
      is_system: false,
      _count: { children: 0, stocks: 0 },
    };
    const outstandingDestinationLine = {
      source_location_id: 'source-bin',
      dest_location_id: destinationLocationId,
      approved_qty: new Prisma.Decimal(5),
      shipped_qty: new Prisma.Decimal(5),
      received_qty: new Prisma.Decimal(2),
      returned_qty: new Prisma.Decimal(1),
    };
    let concurrentTransferCommitted = false;
    const waitForActiveSiteLock = jest
      .fn()
      .mockImplementation(
        (
          query: TemplateStringsArray,
          queryTenantId: string,
          querySiteId: string,
        ) => {
          const statement = query.join(' ');
          if (
            statement.includes('FROM "sites"') &&
            statement.includes('FOR UPDATE') &&
            queryTenantId === 'tenant-1' &&
            querySiteId === 'site-wien'
          ) {
            concurrentTransferCommitted = true;
          }
          return Promise.resolve([]);
        },
      );
    const findTransactionTransferLines = jest.fn().mockImplementation(
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
          concurrentTransferCommitted && queriesActiveDestinationSite
            ? [outstandingDestinationLine]
            : [],
        );
      },
    );
    const buildLocationClient = (findTransferLines: jest.Mock) => ({
      storageLocation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(location)
          .mockResolvedValueOnce(location),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicle: { count: jest.fn().mockResolvedValue(0) },
      stockTransferLine: { findMany: findTransferLines },
    });
    const transactionClient = {
      ...buildLocationClient(findTransactionTransferLines),
      $queryRaw: waitForActiveSiteLock,
    };
    const prisma = {
      ...buildLocationClient(jest.fn().mockResolvedValue([])),
      $transaction: jest.fn(
        (callback: (tx: typeof transactionClient) => unknown) =>
          callback(transactionClient),
      ),
    };
    const service = new LocationService(
      prisma as never,
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
