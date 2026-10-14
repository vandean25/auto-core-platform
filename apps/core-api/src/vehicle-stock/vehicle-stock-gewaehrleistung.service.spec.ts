import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';

describe('VehicleStockQueryService Gewaehrleistung due list', () => {
  const prisma = {
    vehicleSale: { findMany: jest.fn() },
  };
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue('tenant-a') };
  const siteContext = { getSiteId: jest.fn().mockResolvedValue('site-a') };
  let service: VehicleStockQueryService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T16:30:00.000Z'));
    jest.clearAllMocks();
    prisma.vehicleSale.findMany.mockResolvedValue([]);
    service = new VehicleStockQueryService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([30, 60, 90] as const)(
    'queries the inclusive %i-day window with tenant and active-site scope',
    async (endsWithinDays) => {
      await service.listGewaehrleistungDue({ endsWithinDays });
      const windowEnd = new Date('2026-10-08T00:00:00.000Z');
      windowEnd.setUTCDate(windowEnd.getUTCDate() + endsWithinDays);
      windowEnd.setUTCHours(23, 59, 59, 999);

      expect(prisma.vehicleSale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-a',
            site_id: 'site-a',
            vehicle: { is: { tenant_id: 'tenant-a', site_id: 'site-a' } },
            customer: { is: { tenant_id: 'tenant-a' } },
            status: 'INVOICED',
            buyer_is_consumer: true,
            gewaehrleistung_ends_on: {
              gte: new Date('2026-10-08T00:00:00.000Z'),
              lte: windowEnd,
            },
          },
          orderBy: [{ gewaehrleistung_ends_on: 'asc' }, { id: 'asc' }],
        }),
      );
    },
  );

  it('windows on the Vienna day once Vienna midnight has passed while UTC is still the day before', async () => {
    jest.setSystemTime(new Date('2026-10-14T22:30:00.000Z'));

    await service.listGewaehrleistungDue({ endsWithinDays: 30 });

    expect(prisma.vehicleSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gewaehrleistung_ends_on: {
            gte: new Date('2026-10-15T00:00:00.000Z'),
            lte: new Date('2026-11-14T23:59:59.999Z'),
          },
        }),
      }),
    );
  });
});
