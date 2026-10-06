import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { VehicleStockReportsService } from './vehicle-stock-reports.service.js';

describe('VehicleStockReportsService', () => {
  let service: VehicleStockReportsService;
  const prisma = {
    vehicle: { findMany: jest.fn() },
    vehicleSale: { findMany: jest.fn() },
  };
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const siteContext = { getSiteId: jest.fn().mockResolvedValue('site-1') };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VehicleStockReportsService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
    );
  });

  it('keeps missing stock-in vehicles and includes workshop and adjustment costs', async () => {
    const oldPostingDate = new Date();
    oldPostingDate.setDate(oldPostingDate.getDate() - 100);
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
        location: { name: 'Halle 1' },
        purchases: [],
        sales: [],
        ledger_entries: [
          { entry_type: 'PURCHASE', amount: new Prisma.Decimal('10000'), posting_date: oldPostingDate },
          { entry_type: 'WORKSHOP_COST', amount: new Prisma.Decimal('250'), posting_date: new Date('2026-10-02T00:00:00Z') },
          { entry_type: 'ADJUSTMENT', amount: new Prisma.Decimal('50'), posting_date: new Date('2026-10-03T00:00:00Z') },
        ],
      },
      {
        id: 'vehicle-2', make: 'VW', model: 'Golf', year: 2019,
        inventory_role: 'USED', stock_status: 'IN_STOCK', location: null,
        purchases: [], sales: [], ledger_entries: [], vin: null, plate: null,
      },
    ]);

    const report = await service.stockAge({});

    expect(report.data[0].cost_basis).toBe('10300.00');
    expect(report.data[1].days_in_stock).toBeNull();
    expect(report.data[1].missing_stock_in_date).toBe(true);
    expect(report.summary.over_90_count).toBe(1);
    expect(report.summary.over_90_cost_basis).toBe('10300.00');
    expect(prisma.vehicle.findMany.mock.calls[0][0].where).toMatchObject({
      tenant_id: 'tenant-1', site_id: 'site-1',
      inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
    });
  });

  it('uses finalized invoice period, excludes cancelled sales and cancelling credit notes, and reports snapshot margin', async () => {
    prisma.vehicleSale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        sale_number: 'VS-1',
        vehicle_id: 'vehicle-1',
        sale_price: new Prisma.Decimal('12000.00'),
        cost_basis_snapshot: new Prisma.Decimal('10000.00'),
        margin_vat_snapshot: new Prisma.Decimal('333.33'),
        status: 'INVOICED',
        createdAt: new Date('2026-10-04T00:00:00Z'),
        invoice: { date: new Date('2026-10-05T00:00:00Z'), tax_mode: 'MARGIN_SCHEME' },
        vehicle: {
          id: 'vehicle-1', make: 'Audi', model: 'A4', year: 2020,
          inventory_role: 'USED',
          purchases: [{ received_at: new Date('2026-10-01T00:00:00Z') }],
          ledger_entries: [{ posting_date: new Date('2026-09-01T00:00:00Z') }],
        },
      },
    ]);

    const report = await service.margin({ from: '2026-10-01', to: '2026-10-31' });

    expect(report.data[0].gross_margin_eur).toBe('2000.00');
    expect(report.data[0].gross_margin_percent).toBe('16.67');
    expect(report.data[0].days_to_sell).toBe(4);
    expect(report.data[0].margin_taxed).toBe(true);
    expect(report.totals.by_inventory_role.USED.gross_margin_average).toBe('2000.00');
    expect(report.totals.by_inventory_role.USED.sale_price_average).toBe('12000.00');
    const query = prisma.vehicleSale.findMany.mock.calls[0][0];
    expect(query.where.status).toBe('INVOICED');
    expect(query.where.invoice.credit_notes).toEqual({
      none: { tenant_id: 'tenant-1', status: 'FINALIZED' },
    });
    expect(query.where.tenant_id).toBe('tenant-1');
    expect(query.where.site_id).toBe('site-1');
    expect(query.include.vehicle.select.ledger_entries.select).toEqual({
      posting_date: true,
    });
    expect(query.include).not.toHaveProperty('ledger_entries');
  });

  it('flags standard-tax invoices separately from margin-taxed invoices', async () => {
    prisma.vehicleSale.findMany.mockResolvedValue([
      {
        id: 'sale-2', sale_number: 'VS-2', vehicle_id: 'vehicle-2',
        sale_price: new Prisma.Decimal('10000'),
        cost_basis_snapshot: new Prisma.Decimal('8000'),
        margin_vat_snapshot: new Prisma.Decimal('0'),
        createdAt: new Date(),
        invoice: { date: new Date('2026-10-05T00:00:00Z'), tax_mode: 'STANDARD' },
        vehicle: {
          id: 'vehicle-2', make: 'VW', model: 'Golf', year: 2022,
          inventory_role: 'USED', purchases: [], ledger_entries: [],
        },
      },
    ]);

    const report = await service.margin({ from: '2026-10-01', to: '2026-10-31' });

    expect(report.data[0].margin_taxed).toBe(false);
    expect(report.data[0].days_to_sell).toBeNull();
  });
});
