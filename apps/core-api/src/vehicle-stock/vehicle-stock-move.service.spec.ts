import { UnprocessableEntityException } from '@nestjs/common';
import { VehicleInventoryRole, VehicleStockStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { VehicleStockMoveService } from './vehicle-stock-move.service.js';

describe('VehicleStockMoveService', () => {
  type TestPrisma = {
    vehicle: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  const tenantId = 'tenant-1';
  const sourceSiteId = 'site-1';
  const targetSiteId = 'site-2';
  const vehicleId = 'vehicle-1';
  const currentLocationId = 'lot-1';
  const targetLocationId = 'lot-2';
  let service: VehicleStockMoveService;
  let prisma: TestPrisma;
  let tenantContext: { getTenantId: jest.Mock };
  let siteContext: { listAuthorizedSiteIds: jest.Mock };

  beforeEach(() => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: sourceSiteId, is_active: true },
          { id: targetSiteId, is_active: true },
        ])
        .mockResolvedValueOnce([
          {
            id: vehicleId,
            location_id: currentLocationId,
            site_id: sourceSiteId,
            inventory_role: VehicleInventoryRole.USED,
            stock_status: VehicleStockStatus.IN_STOCK,
          },
        ]),
      site: {
        findMany: jest.fn().mockResolvedValue([
          { id: sourceSiteId, legal_entity_id: 'entity-1' },
          { id: targetSiteId, legal_entity_id: 'entity-1' },
        ]),
      },
      storageLocation: {
        findFirst: jest.fn().mockResolvedValue({ id: targetLocationId }),
      },
      vehicle: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          id: vehicleId,
          site_id: targetSiteId,
          location_id: targetLocationId,
        }),
      },
    };
    prisma = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue({
          id: vehicleId,
          site_id: sourceSiteId,
          location: { site_id: sourceSiteId },
        }),
      },
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };
    tenantContext = { getTenantId: jest.fn().mockResolvedValue(tenantId) };
    siteContext = {
      listAuthorizedSiteIds: jest
        .fn()
        .mockResolvedValue([sourceSiteId, targetSiteId]),
    };
    service = new VehicleStockMoveService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

  it('moves a parked dealer vehicle between authorized sites of one legal entity', async () => {
    await expect(
      service.moveAcrossSites(vehicleId, {
        toSiteId: targetSiteId,
        toLocationId: targetLocationId,
        expectedLocationId: currentLocationId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ location_id: targetLocationId }),
    );
  });

  it('rejects a cross-legal-entity vehicle move', async () => {
    prisma.$transaction = jest.fn((callback: (client: unknown) => unknown) =>
      callback({
        $queryRaw: jest.fn().mockResolvedValue([
          { id: sourceSiteId, is_active: true },
          { id: targetSiteId, is_active: true },
        ]),
        site: {
          findMany: jest.fn().mockResolvedValue([
            { id: sourceSiteId, legal_entity_id: 'entity-1' },
            { id: targetSiteId, legal_entity_id: 'entity-2' },
          ]),
        },
      }),
    );

    await expect(
      service.moveAcrossSites(vehicleId, {
        toSiteId: targetSiteId,
        toLocationId: targetLocationId,
        expectedLocationId: currentLocationId,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
