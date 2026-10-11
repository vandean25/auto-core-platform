import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import { VehicleStockReportsService } from './vehicle-stock-reports.service.js';

const TENANT_A = 'tenant-a';
const SITE_ACTIVE = 'site-active';
const SITE_OTHER = 'site-other';
const SITE_FOREIGN = 'site-of-another-tenant';

/**
 * The MCP scope on the dealer stock reports: an explicit site must be one the caller is
 * authorized for, an offset pages past earlier rows, and the stock-in window bounds stock age.
 */
describe('VehicleStockReportsService MCP scope', () => {
  let service: VehicleStockReportsService;
  const prisma = {
    vehicle: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    vehicleSale: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    invoice: { aggregate: jest.fn() },
  };
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue(TENANT_A) };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE),
    listAuthorizedSiteIds: jest
      .fn()
      .mockResolvedValue([SITE_ACTIVE, SITE_OTHER]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.vehicle.findMany.mockResolvedValue([]);
    prisma.vehicle.count.mockResolvedValue(0);
    prisma.vehicle.aggregate.mockResolvedValue({
      _count: { id: 0 },
      _sum: { stock_cost_basis: null },
    });
    prisma.vehicleSale.findMany.mockResolvedValue([]);
    prisma.vehicleSale.count.mockResolvedValue(0);
    prisma.vehicleSale.aggregate.mockResolvedValue({ _sum: {}, _avg: {} });
    prisma.invoice.aggregate.mockResolvedValue({ _sum: {}, _avg: {} });
    service = new VehicleStockReportsService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

  it('reports stock age for an explicit authorized site without reading the active site', async () => {
    await service.stockAge({ siteId: SITE_OTHER, limit: 25 });

    expect(siteContext.getSiteId).not.toHaveBeenCalled();
    expect(prisma.vehicle.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ tenant_id: TENANT_A, site_id: SITE_OTHER }),
    );
  });

  it('does not query when the requested site is not one the caller is authorized for', async () => {
    await expect(
      service.stockAge({ siteId: SITE_FOREIGN, limit: 25 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.margin({
        from: '2026-10-01',
        to: '2026-10-31',
        siteId: SITE_FOREIGN,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
    expect(prisma.vehicleSale.findMany).not.toHaveBeenCalled();
  });

  it('keeps the tenant and the site on the margin query for an explicit site', async () => {
    await service.margin({
      from: '2026-10-01',
      to: '2026-10-31',
      siteId: SITE_OTHER,
    });

    expect(prisma.vehicleSale.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ tenant_id: TENANT_A, site_id: SITE_OTHER }),
    );
    expect(prisma.invoice.aggregate.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ tenant_id: TENANT_A, site_id: SITE_OTHER }),
    );
  });

  it('pages stock age by offset, so the page after a cursor starts at that row', async () => {
    prisma.vehicle.count.mockResolvedValue(60);

    const report = await service.stockAge({ offset: 25, limit: 25 });

    expect(prisma.vehicle.findMany.mock.calls[0][0]).toMatchObject({
      skip: 25,
      take: 25,
    });
    expect(report.meta).toMatchObject({ total: 60, page: 2, limit: 25 });
  });

  it('pages margins by offset and keeps the REST page number path unchanged', async () => {
    await service.margin({
      from: '2026-10-01',
      to: '2026-10-31',
      offset: 10,
      limit: 5,
    });
    await service.margin({
      from: '2026-10-01',
      to: '2026-10-31',
      page: 3,
      limit: 5,
    });

    expect(prisma.vehicleSale.findMany.mock.calls[0][0]).toMatchObject({
      skip: 10,
      take: 5,
    });
    expect(prisma.vehicleSale.findMany.mock.calls[1][0]).toMatchObject({
      skip: 10,
      take: 5,
    });
    expect(siteContext.getSiteId).toHaveBeenCalledTimes(2);
  });

  it('limits stock age to the stock-in window, both dates inclusive, and keeps the bucket filter', async () => {
    await service.stockAge({
      stockReceivedFrom: '2026-07-01',
      stockReceivedTo: '2026-07-31',
      bucket: '91_180',
    });

    const where = prisma.vehicle.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      {
        stock_received_at: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-31T23:59:59.999Z'),
        },
      },
    ]);
    expect(where.stock_received_at).toEqual(
      expect.objectContaining({ lt: expect.any(Date) }),
    );
  });

  it('rejects a stock-in window with only one date before any query', async () => {
    await expect(
      service.stockAge({ stockReceivedFrom: '2026-07-01', limit: 25 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
  });
});
