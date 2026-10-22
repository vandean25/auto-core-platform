import { Prisma } from '@prisma/client';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { VehicleStockReportsService } from '../vehicle-stock/vehicle-stock-reports.service.js';
import { encodeMcpCursor } from './mcp-output.util.js';
import { McpStockReadService } from './mcp-stock-read.service.js';

const SITE_ACTIVE = '00000000-0000-4000-8000-0000000000a1';
const SITE_REQUESTED = '00000000-0000-4000-8000-0000000000a9';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const CATALOG_ITEM = '00000000-0000-4000-8000-0000000000c1';
const BIN_ID = '00000000-0000-4000-8000-0000000000b1';
const MASTER_PART_ID = '00000000-0000-4000-8000-0000000000m1';
const WORKSHOP_ORDER = '00000000-0000-4000-8000-0000000000w1';

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

describe('McpStockReadService AUT-428 stock ids', () => {
  it('adds catalog_item_id and bin_id to inventory search rows', async () => {
    const inventoryService = {
      findAll: jest.fn().mockResolvedValue({
        data: [
          {
            id: CATALOG_ITEM,
            sku: 'FILTER-DEMO-01',
            name: 'Oil filter',
            brand: 'Demo',
            brand_id: 1,
            price: 10,
            status: 'IN_STOCK',
            quantity_available: 4,
            warehouse_location: 'Shelf A',
          },
        ],
        meta: { total: 1, page: 1, pageSize: 10, pageCount: 1 },
      }),
    };
    const prisma = {
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            catalog_item_id: CATALOG_ITEM,
            location_id: BIN_ID,
            quantity_on_hand: new Prisma.Decimal(3),
            quantity_reserved: new Prisma.Decimal(0),
            location: { name: 'Shelf A', code: 'A-01' },
          },
        ]),
      },
    };
    const tenantContext = { getTenantId: jest.fn().mockResolvedValue(TENANT_A) };
    const siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE) };
    const service = new McpStockReadService(
      {} as CatalogService,
      inventoryService as unknown as InventoryService,
      prisma as unknown as PrismaService,
      siteContext as unknown as SiteContextService,
      tenantContext as unknown as TenantContextService,
      {} as VehicleStockReportsService,
    );

    const result = await service.searchParts({ query: 'filter' });
    if (!('data' in result)) throw new Error('expected a data result');

    expect(result.data[0]).toMatchObject({
      catalog_item_id: CATALOG_ITEM,
      bin_id: BIN_ID,
      bin_label: 'Shelf A',
    });
  });

  it('returns catalog_item_id and per-bin levels for get_stock_level by SKU', async () => {
    const inventoryService = {
      checkAvailability: jest.fn().mockResolvedValue({
        sku: 'FILTER-DEMO-01',
        name: 'Oil filter',
        brand: 'Demo',
        quantity_on_hand: 3,
        quantity_reserved: 0,
        quantity_available: 3,
        is_superseded: false,
      }),
    };
    const prisma = {
      catalogItem: {
        findFirst: jest.fn().mockResolvedValue({ id: CATALOG_ITEM }),
      },
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            catalog_item_id: CATALOG_ITEM,
            location_id: BIN_ID,
            quantity_on_hand: new Prisma.Decimal(3),
            quantity_reserved: new Prisma.Decimal(0),
            location: { name: 'Shelf A', code: 'A-01' },
          },
        ]),
      },
    };
    const tenantContext = { getTenantId: jest.fn().mockResolvedValue(TENANT_A) };
    const siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE) };
    const service = new McpStockReadService(
      {} as CatalogService,
      inventoryService as unknown as InventoryService,
      prisma as unknown as PrismaService,
      siteContext as unknown as SiteContextService,
      tenantContext as unknown as TenantContextService,
      {} as VehicleStockReportsService,
    );

    const result = await service.getStockLevel({ sku: 'FILTER-DEMO-01' });

    expect(result).toMatchObject({
      catalog_item_id: CATALOG_ITEM,
      bin_id: BIN_ID,
      bins: [
        {
          location_id: BIN_ID,
          quantity_on_hand: 3,
          quantity_available: 3,
        },
      ],
    });
  });

  it('enriches workshop catalog search parts with catalog_item_id and bin_id', async () => {
    const catalogService = {
      search: jest.fn().mockResolvedValue({
        labor: [],
        parts: [
          {
            id: CATALOG_ITEM,
            supplierPartNumber: 'FILTER-DEMO-01',
            oemNumber: null,
            description: 'Oil filter',
            brand: 'Demo',
            quantityOnHand: 3,
            binLocation: 'A-01',
            costPrice: 1,
            retailPrice: 2,
          },
          {
            id: MASTER_PART_ID,
            supplierPartNumber: 'MASTER-01',
            oemNumber: 'OEM-1',
            description: 'Master part',
            brand: 'Demo',
            quantityOnHand: 0,
            binLocation: null,
            costPrice: null,
            retailPrice: null,
          },
        ],
        meta: { laborCount: 0, partCount: 2, limit: 25 },
      }),
    };
    const prisma = {
      catalogItem: {
        findMany: jest.fn().mockResolvedValue([{ id: CATALOG_ITEM }]),
      },
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            catalog_item_id: CATALOG_ITEM,
            location_id: BIN_ID,
            quantity_on_hand: new Prisma.Decimal(3),
            quantity_reserved: new Prisma.Decimal(0),
            location: { name: 'Shelf A', code: 'A-01' },
          },
        ]),
      },
    };
    const tenantContext = { getTenantId: jest.fn().mockResolvedValue(TENANT_A) };
    const siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE) };
    const service = new McpStockReadService(
      catalogService as unknown as CatalogService,
      {} as InventoryService,
      prisma as unknown as PrismaService,
      siteContext as unknown as SiteContextService,
      tenantContext as unknown as TenantContextService,
      {} as VehicleStockReportsService,
    );

    const result = await service.searchParts({
      query: 'filter',
      workshop_order_id: WORKSHOP_ORDER,
    });
    if (!('parts' in result)) throw new Error('expected a parts result');

    expect(catalogService.search).toHaveBeenCalledWith('filter', WORKSHOP_ORDER);
    expect(result.parts[0]).toMatchObject({
      catalog_item_id: CATALOG_ITEM,
      bin_id: BIN_ID,
      bin_label: 'Shelf A',
    });
    expect(result.parts[1]).toMatchObject({
      catalog_item_id: null,
      bin_id: null,
      bin_label: null,
    });
  });

  it('skips catalog item lookup when workshop catalog search returns no parts', async () => {
    const catalogService = {
      search: jest.fn().mockResolvedValue({
        labor: [],
        parts: [],
        meta: { laborCount: 0, partCount: 0, limit: 25 },
      }),
    };
    const prisma = {
      catalogItem: { findMany: jest.fn() },
      inventoryStock: { findMany: jest.fn() },
    };
    const tenantContext = { getTenantId: jest.fn().mockResolvedValue(TENANT_A) };
    const siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE) };
    const service = new McpStockReadService(
      catalogService as unknown as CatalogService,
      {} as InventoryService,
      prisma as unknown as PrismaService,
      siteContext as unknown as SiteContextService,
      tenantContext as unknown as TenantContextService,
      {} as VehicleStockReportsService,
    );

    const result = await service.searchParts({
      query: 'filter',
      workshop_order_id: WORKSHOP_ORDER,
    });
    if (!('parts' in result)) throw new Error('expected a parts result');

    expect(result.parts).toEqual([]);
    expect(prisma.catalogItem.findMany).not.toHaveBeenCalled();
    expect(prisma.inventoryStock.findMany).not.toHaveBeenCalled();
  });
});

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
