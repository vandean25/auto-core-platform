import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { VehicleStockReportsService } from './vehicle-stock-reports.service.js';

describe('VehicleStockReportsService', () => {
  let service: VehicleStockReportsService;
  const prisma = {
    vehicle: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    vehicleSale: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    invoice: { aggregate: jest.fn() },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const siteContext = { getSiteId: jest.fn().mockResolvedValue('site-1') };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VehicleStockReportsService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

  it('pages stock age in Prisma and aggregates aged stock by the current cycle snapshot', async () => {
    const stockReceivedAt = new Date('2026-07-01T00:00:00Z');
    prisma.vehicle.findMany.mockResolvedValue([
      {
        id: 'vehicle-1',
        make: 'Audi',
        model: 'A4',
        year: 2020,
        vin: null,
        plate: null,
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
        stock_received_at: stockReceivedAt,
        stock_cost_basis: new Prisma.Decimal('10300'),
        location: { name: 'Halle 1' },
        sales: [],
      },
      {
        id: 'vehicle-2',
        make: 'VW',
        model: 'Golf',
        year: 2019,
        vin: null,
        plate: null,
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
        stock_received_at: null,
        stock_cost_basis: null,
        location: null,
        sales: [],
      },
    ]);
    prisma.vehicle.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5);
    prisma.vehicle.aggregate.mockResolvedValue({
      _count: { id: 1 },
      _sum: { stock_cost_basis: new Prisma.Decimal('10300') },
    });

    const report = await service.stockAge({
      page: 2,
      limit: 10,
      bucket: 'over_90',
      inventory_role: 'USED',
      stock_status: 'IN_STOCK',
    });

    expect(report.data[0].cost_basis).toBe('10300.00');
    expect(report.data[1].days_in_stock).toBeNull();
    expect(report.data[1].missing_stock_in_date).toBe(true);
    expect(report.summary.over_90_count).toBe(1);
    expect(report.summary.over_90_cost_basis).toBe('10300.00');
    expect(report.summary.bucket_counts).toEqual({
      '0_30': 4,
      '31_60': 3,
      '61_90': 2,
      '91_180': 1,
      over_180: 5,
    });
    expect(report.meta).toMatchObject({ total: 2, page: 2, limit: 10 });
    const pageQuery = prisma.vehicle.findMany.mock.calls[0][0];
    expect(pageQuery).toMatchObject({ skip: 10, take: 10 });
    expect(pageQuery.where).toMatchObject({
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      inventory_role: 'USED',
      stock_status: 'IN_STOCK',
    });
    expect(pageQuery.where.stock_received_at.lt).toBeInstanceOf(Date);
    expect(prisma.vehicle.count).toHaveBeenNthCalledWith(1, {
      where: pageQuery.where,
    });
    expect(
      prisma.vehicle.aggregate.mock.calls[0][0].where.stock_received_at.lt,
    ).toBeInstanceOf(Date);
    expect(prisma.vehicle.aggregate.mock.calls[0][0].where).toMatchObject({
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      inventory_role: 'USED',
      stock_status: 'IN_STOCK',
    });
  });

  it('uses invoice net for margin and pages without requiring the vehicle current site', async () => {
    prisma.vehicleSale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        sale_number: 'VS-1',
        vehicle_id: 'vehicle-1',
        cost_basis_snapshot: new Prisma.Decimal('10000.00'),
        days_to_sell_snapshot: 4,
        invoice: {
          date: new Date('2026-10-05T00:00:00Z'),
          total_net: new Prisma.Decimal('11666.67'),
          tax_mode: 'MARGIN_SCHEME',
        },
        vehicle: { id: 'vehicle-1', make: 'Audi', model: 'A4', year: 2020 },
      },
    ]);
    prisma.vehicleSale.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.vehicleSale.aggregate.mockResolvedValue({
      _sum: { cost_basis_snapshot: new Prisma.Decimal('10000') },
      _avg: {
        cost_basis_snapshot: new Prisma.Decimal('10000'),
        days_to_sell_snapshot: new Prisma.Decimal('4'),
      },
    });
    prisma.invoice.aggregate
      .mockResolvedValueOnce({
        _sum: { total_net: new Prisma.Decimal('11666.67') },
        _avg: { total_net: new Prisma.Decimal('11666.67') },
      })
      .mockResolvedValueOnce({
        _sum: { total_net: new Prisma.Decimal('11666.67') },
        _avg: { total_net: new Prisma.Decimal('11666.67') },
      });

    const report = await service.margin({
      from: '2026-10-01',
      to: '2026-10-31',
      page: 2,
      limit: 10,
    });

    expect(report.data[0].sale_price).toBe('11666.67');
    expect(report.data[0].gross_margin_eur).toBe('1666.67');
    expect(report.data[0].gross_margin_percent).toBe('14.29');
    expect(report.data[0].days_to_sell).toBe(4);
    expect(report.data[0].margin_taxed).toBe(true);
    expect(report.totals.by_inventory_role.USED.gross_margin_average).toBe(
      '1666.67',
    );
    expect(report.totals.by_inventory_role.USED.sale_price_average).toBe(
      '11666.67',
    );
    expect(report.totals.gross_margin_known_count).toBe(1);
    expect(report.totals.gross_margin_unknown_count).toBe(0);

    const pageQuery = prisma.vehicleSale.findMany.mock.calls[0][0];
    expect(pageQuery).toMatchObject({ skip: 10, take: 10 });
    expect(pageQuery.where).toMatchObject({
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      status: 'INVOICED',
      vehicle: { tenant_id: 'tenant-1' },
    });
    expect(pageQuery.where.invoice.is).toMatchObject({
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      status: 'FINALIZED',
      credit_notes: { none: { tenant_id: 'tenant-1', status: 'FINALIZED' } },
    });
    expect(pageQuery.where.vehicle).not.toHaveProperty('site_id');
    expect(prisma.vehicleSale.count).toHaveBeenNthCalledWith(1, {
      where: pageQuery.where,
    });
  });

  it('reports standard-tax invoices as not margin taxed and preserves missing margin values', async () => {
    prisma.vehicleSale.findMany.mockResolvedValue([
      {
        id: 'sale-2',
        sale_number: 'VS-2',
        vehicle_id: 'vehicle-2',
        cost_basis_snapshot: null,
        days_to_sell_snapshot: null,
        invoice: {
          date: new Date('2026-10-05T00:00:00Z'),
          total_net: new Prisma.Decimal('10000'),
          tax_mode: 'STANDARD',
        },
        vehicle: { id: 'vehicle-2', make: 'VW', model: 'Golf', year: 2022 },
      },
    ]);
    prisma.vehicleSale.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.vehicleSale.aggregate.mockResolvedValue({
      _sum: { cost_basis_snapshot: null },
      _avg: { cost_basis_snapshot: null, days_to_sell_snapshot: null },
    });
    prisma.invoice.aggregate
      .mockResolvedValueOnce({
        _sum: { total_net: new Prisma.Decimal('10000') },
        _avg: { total_net: new Prisma.Decimal('10000') },
      })
      .mockResolvedValueOnce({
        _sum: { total_net: null },
        _avg: { total_net: null },
      });

    const report = await service.margin({
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(report.data[0].margin_taxed).toBe(false);
    expect(report.data[0].gross_margin_eur).toBeNull();
    expect(report.data[0].days_to_sell).toBeNull();
    expect(report.totals.gross_margin_total).toBe('0.00');
    expect(report.totals.gross_margin_known_count).toBe(0);
    expect(report.totals.gross_margin_unknown_count).toBe(1);
  });

  it('rejects impossible calendar dates instead of normalizing the report period', async () => {
    await expect(
      service.margin({ from: '2026-02-31', to: '2026-04-01' }),
    ).rejects.toThrow('from and to must be valid ISO dates with from <= to');
    expect(prisma.vehicleSale.findMany).not.toHaveBeenCalled();
  });
});
