import type { SiteContextService } from '../site/site-context.service.js';
import type { VehicleStockReportsService } from '../vehicle-stock/vehicle-stock-reports.service.js';
import { encodeMcpCursor } from './mcp-output.util.js';
import { McpStockReadService } from './mcp-stock-read.service.js';

const SITE_ACTIVE = '00000000-0000-4000-8000-0000000000a1';
const SITE_REQUESTED = '00000000-0000-4000-8000-0000000000a9';

const emptyStockAge = {
  data: [],
  meta: {
    total: 0,
    page: 1,
    limit: 10,
    pageSize: 10,
    totalPages: 0,
    pageCount: 0,
  },
  summary: {
    over_90_count: 0,
    over_90_cost_basis: '0.00',
    bucket_counts: {
      '0_30': 0,
      '31_60': 0,
      '61_90': 0,
      '91_180': 0,
      over_180: 0,
    },
  },
};

const emptyMargin = {
  data: [],
  meta: {
    total: 0,
    page: 1,
    limit: 10,
    pageSize: 10,
    totalPages: 0,
    pageCount: 0,
  },
  totals: {
    count: 0,
    gross_margin_known_count: 0,
    gross_margin_unknown_count: 0,
    gross_margin_total: '0.00',
    gross_margin_average: null,
    by_inventory_role: {
      USED: {
        count: 0,
        gross_margin_known_count: 0,
        gross_margin_unknown_count: 0,
        gross_margin_total: '0.00',
        gross_margin_average: null,
        gross_margin_percent_average: null,
        sale_price_total: '0.00',
        sale_price_average: null,
        cost_basis_total: '0.00',
        cost_basis_average: null,
        days_to_sell_average: null,
      },
    },
  },
};

describe('McpStockReadService AUT-461 stock reports', () => {
  let service: McpStockReadService;
  let siteContext: { getSiteId: jest.Mock };
  let stockReports: { stockAge: jest.Mock; margin: jest.Mock };

  beforeEach(() => {
    siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE) };
    stockReports = {
      stockAge: jest.fn().mockResolvedValue(emptyStockAge),
      margin: jest.fn().mockResolvedValue(emptyMargin),
    };
    const unused = {} as never;
    service = new McpStockReadService(
      unused,
      unused,
      unused,
      siteContext as unknown as SiteContextService,
      unused,
      stockReports as unknown as VehicleStockReportsService,
    );
  });

  it('reports the dealer stock age of the active site when no site is given', async () => {
    const report = await service.vehicleStockAgeReport({});

    expect(stockReports.stockAge).toHaveBeenCalledWith({
      inventory_role: undefined,
      stock_status: undefined,
      bucket: undefined,
      siteId: SITE_ACTIVE,
      stockReceivedFrom: undefined,
      stockReceivedTo: undefined,
      offset: 0,
      limit: 10,
    });
    expect(report).toMatchObject({
      site_id: SITE_ACTIVE,
      period: null,
      meta: { total: 0, page_size: 10, next_cursor: null },
    });
  });

  it('limits the stock age report to the stock-in window and an authorized site', async () => {
    const report = await service.vehicleStockAgeReport({
      from: '2026-07-01',
      to: '2026-07-31',
      site_id: SITE_REQUESTED,
    });

    expect(siteContext.getSiteId).not.toHaveBeenCalled();
    expect(stockReports.stockAge).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_REQUESTED,
        stockReceivedFrom: '2026-07-01',
        stockReceivedTo: '2026-07-31',
      }),
    );
    expect(report.period).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('pages the stock age report by pageSize from an opaque cursor', async () => {
    stockReports.stockAge.mockResolvedValue({
      ...emptyStockAge,
      meta: { ...emptyStockAge.meta, total: 60 },
    });

    const report = await service.vehicleStockAgeReport({
      pageSize: 25,
      cursor: encodeMcpCursor(25),
    });

    expect(stockReports.stockAge).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 25, limit: 25 }),
    );
    expect(report.meta).toMatchObject({ total: 60, page_size: 25 });
    expect(report.meta.next_cursor).toEqual(expect.any(String));
  });

  it('caps the stock age page at 25 rows even if a larger pageSize reaches the service', async () => {
    await service.vehicleStockAgeReport({ pageSize: 30 });

    expect(stockReports.stockAge).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
  });

  it('reports the invoiced margins of a period for the active site and pages them by pageSize', async () => {
    stockReports.margin.mockResolvedValue({
      ...emptyMargin,
      meta: { ...emptyMargin.meta, total: 26 },
    });

    const report = await service.vehicleStockMarginReport({
      from: '2026-10-01',
      to: '2026-10-31',
      pageSize: 25,
    });

    expect(stockReports.margin).toHaveBeenCalledWith({
      from: '2026-10-01',
      to: '2026-10-31',
      siteId: SITE_ACTIVE,
      offset: 0,
      limit: 25,
    });
    expect(report).toMatchObject({
      site_id: SITE_ACTIVE,
      period: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(report.meta.next_cursor).toEqual(expect.any(String));
  });

  it('caps the margin page at 25 rows and passes a requested site through', async () => {
    await service.vehicleStockMarginReport({
      from: '2026-10-01',
      to: '2026-10-31',
      site_id: SITE_REQUESTED,
      pageSize: 40,
    });

    expect(stockReports.margin).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_REQUESTED, limit: 25 }),
    );
    expect(siteContext.getSiteId).not.toHaveBeenCalled();
  });
});
