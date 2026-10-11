import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpCatalogReadService } from './mcp-catalog-read.service.js';
import {
  encodeMcpKeysetCursor,
  encodeMcpPositionCursor,
} from './mcp-output.util.js';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Order = Record<string, 'asc' | 'desc'>;
type Select = Record<string, boolean | { select: Select }>;
type FindArgs = {
  where?: Where;
  orderBy?: Order | Order[];
  take?: number;
  select?: Select;
};

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000b1';

const ids = {
  brake1: '00000000-0000-4000-8000-0000000000c1',
  brake2: '00000000-0000-4000-8000-0000000000c2',
  oilOld: '00000000-0000-4000-8000-0000000000c3',
  oilNew: '00000000-0000-4000-8000-0000000000c4',
  wiper: '00000000-0000-4000-8000-0000000000c5',
  otherBrake: '00000000-0000-4000-8000-0000000000c9',
  oilLabor: '00000000-0000-4000-8000-0000000000d1',
  retiredLabor: '00000000-0000-4000-8000-0000000000d2',
  otherLabor: '00000000-0000-4000-8000-0000000000d9',
  jobSep: '00000000-0000-4000-8000-0000000000e1',
  jobAug: '00000000-0000-4000-8000-0000000000e2',
  jobDryRun: '00000000-0000-4000-8000-0000000000e3',
  jobCustomer: '00000000-0000-4000-8000-0000000000e4',
  jobOther: '00000000-0000-4000-8000-0000000000e9',
  jobTie: '00000000-0000-4000-8000-0000000000e0',
  vendorA: '00000000-0000-4000-8000-0000000000f1',
  vendorB: '00000000-0000-4000-8000-0000000000f9',
  ruleBrake: '00000000-0000-4000-8000-0000000000a1',
  ruleRrp: '00000000-0000-4000-8000-0000000000a2',
  ruleFallback: '00000000-0000-4000-8000-0000000000a3',
  ruleOther: '00000000-0000-4000-8000-0000000000a9',
  binFull: '00000000-0000-4000-8000-0000000000b5',
  binEmpty: '00000000-0000-4000-8000-0000000000b6',
  binOther: '00000000-0000-4000-8000-0000000000b7',
  binWarehouse: '00000000-0000-4000-8000-0000000000b8',
  binDeleted: '00000000-0000-4000-8000-0000000000b9',
};

const dec = (value: string) => new Prisma.Decimal(value);
const at = (iso: string) => new Date(iso);

/* ---------- in-memory Prisma double: the filtering and ordering the service relies on ---------- */

const OPERATORS = new Set([
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not',
  'contains',
  'mode',
  'equals',
]);

function comparable(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined;
}

function fieldMatches(value: unknown, condition: unknown): boolean {
  if (condition === null) {
    return isMissing(value);
  }
  if (
    typeof condition === 'object' &&
    !(condition instanceof Date) &&
    !(condition instanceof Prisma.Decimal)
  ) {
    const operators = condition as Record<string, unknown>;
    if (!Object.keys(operators).some((key) => OPERATORS.has(key))) {
      // A relation filter such as `location: { type: 'bin' }`.
      return isMissing(value) ? false : matches(value as Row, operators);
    }
    return Object.entries(operators).every(([operator, argument]) => {
      switch (operator) {
        case 'mode':
          return true;
        case 'equals':
          return comparable(value) === comparable(argument);
        case 'contains':
          return (typeof value === 'string' ? value : '')
            .toLowerCase()
            .includes(String(argument).toLowerCase());
        case 'gt':
          return (
            !isMissing(value) &&
            (comparable(value) as number) > (comparable(argument) as number)
          );
        case 'gte':
          return (
            !isMissing(value) &&
            (comparable(value) as number) >= (comparable(argument) as number)
          );
        case 'lt':
          return (
            !isMissing(value) &&
            (comparable(value) as number) < (comparable(argument) as number)
          );
        case 'lte':
          return (
            !isMissing(value) &&
            (comparable(value) as number) <= (comparable(argument) as number)
          );
        case 'in':
          return (argument as unknown[]).some(
            (candidate) => comparable(candidate) === comparable(value),
          );
        case 'not':
          return argument === null
            ? !isMissing(value)
            : comparable(value) !== comparable(argument);
        default:
          throw new Error(
            `Unsupported operator in the test double: ${operator}`,
          );
      }
    });
  }
  return comparable(value) === comparable(condition);
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Where[]).every((part) => matches(row, part));
    }
    if (key === 'OR') {
      return (condition as Where[]).some((part) => matches(row, part));
    }
    return fieldMatches(row[key], condition);
  });
}

function sortRows(rows: Row[], orderBy: Order | Order[] | undefined): Row[] {
  if (!orderBy) {
    return rows;
  }
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      for (const [key, direction] of Object.entries(clause)) {
        const a = comparable(left[key]) as number | string;
        const b = comparable(right[key]) as number | string;
        if (a === b) {
          continue;
        }
        const ascending = a < b ? -1 : 1;
        return direction === 'asc' ? ascending : -ascending;
      }
    }
    return 0;
  });
}

function projectRow(row: Row, select: Select | undefined): Row {
  if (!select) {
    return { ...row };
  }
  const projected: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (spec === false) {
      continue;
    }
    if (spec === true) {
      projected[key] = row[key];
    } else {
      projected[key] = isMissing(row[key])
        ? null
        : projectRow(row[key] as Row, spec.select);
    }
  }
  return projected;
}

function runQuery(rows: Row[], args: FindArgs): Row[] {
  const filtered = rows.filter((row) => matches(row, args.where));
  const sorted = sortRows(filtered, args.orderBy);
  const limited = args.take === undefined ? sorted : sorted.slice(0, args.take);
  return limited.map((row) => projectRow(row, args.select));
}

function delegate(rows: Row[]) {
  return {
    findMany: jest.fn(async (args: FindArgs = {}) => runQuery(rows, args)),
    findFirst: jest.fn(
      async (args: FindArgs = {}) => runQuery(rows, args)[0] ?? null,
    ),
  };
}

/* ---------- fixtures: two tenants, so every read must stay in its own tenant ---------- */

function buildTables() {
  const brandNamed = (id: number, name: string, tenantId: string) => ({
    id,
    name,
    tenant_id: tenantId,
  });
  const parts: Row[] = [
    {
      id: ids.brake1,
      tenant_id: TENANT_A,
      sku: 'BRK-100',
      name: 'Brake pad set',
      unit: 'pcs',
      ean: '4006381333931',
      cost_price: dec('7.4'),
      retail_price: dec('12.5'),
      oem_numbers: ['1K0698451', 42],
      superseded_by_id: null,
      brand_id: 4,
      revenue_group_id: 2,
    },
    {
      id: ids.brake2,
      tenant_id: TENANT_A,
      sku: 'BRK-101',
      name: 'Brake disc',
      unit: 'pcs',
      ean: null,
      cost_price: null,
      retail_price: dec('40'),
      oem_numbers: null,
      superseded_by_id: null,
      brand_id: null,
      revenue_group_id: 2,
    },
    {
      id: ids.oilOld,
      tenant_id: TENANT_A,
      sku: 'FLT-200',
      name: 'Oil filter',
      unit: 'pcs',
      ean: null,
      cost_price: dec('4'),
      retail_price: dec('9'),
      oem_numbers: [],
      superseded_by_id: ids.oilNew,
      brand_id: null,
      revenue_group_id: 2,
    },
    {
      id: ids.oilNew,
      tenant_id: TENANT_A,
      sku: 'FLT-201',
      name: 'Oil filter (new)',
      unit: 'pcs',
      ean: null,
      cost_price: dec('5'),
      retail_price: dec('10'),
      oem_numbers: [],
      superseded_by_id: null,
      brand_id: null,
      revenue_group_id: 2,
    },
    {
      id: ids.wiper,
      tenant_id: TENANT_A,
      sku: 'WPR-300',
      name: 'Wiper blade',
      unit: 'pcs',
      ean: null,
      cost_price: null,
      retail_price: dec('6'),
      oem_numbers: null,
      superseded_by_id: null,
      brand_id: null,
      revenue_group_id: null,
    },
    {
      id: ids.otherBrake,
      tenant_id: TENANT_B,
      sku: 'BRK-999',
      name: 'Other tenant brake',
      unit: 'pcs',
      ean: null,
      cost_price: dec('0.5'),
      retail_price: dec('1'),
      oem_numbers: null,
      superseded_by_id: null,
      brand_id: null,
      revenue_group_id: null,
    },
  ];

  const laborOperations: Row[] = [
    {
      id: ids.oilLabor,
      tenant_id: TENANT_A,
      code: 'OIL-SERVICE',
      description: 'Oil service',
      hourly_rate: dec('95'),
      is_active: true,
    },
    {
      id: ids.retiredLabor,
      tenant_id: TENANT_A,
      code: 'OLD-JOB',
      description: 'Retired job',
      hourly_rate: dec('80'),
      is_active: false,
    },
    {
      id: ids.otherLabor,
      tenant_id: TENANT_B,
      code: 'OIL-SERVICE',
      description: 'Other oil service',
      hourly_rate: dec('1'),
      is_active: true,
    },
  ];

  const importJobs: Row[] = [
    {
      id: ids.jobSep,
      tenant_id: TENANT_A,
      entity_type: 'SUPPLIER_PRICE_LIST',
      status: 'APPLIED',
      file_name: 'supplier-sep.csv',
      appliedAt: at('2026-09-15T10:00:00.000Z'),
      totals_json: { rows: 412, create: 3, update: 400, skip: 9, error: 0 },
      options_json: { vendor_id: ids.vendorA },
    },
    {
      id: ids.jobAug,
      tenant_id: TENANT_A,
      entity_type: 'SUPPLIER_PRICE_LIST',
      status: 'APPLIED',
      file_name: 'supplier-aug.csv',
      appliedAt: at('2026-08-01T09:00:00.000Z'),
      totals_json: { rows: 120 },
      options_json: { vendor_id: ids.vendorA },
    },
    {
      id: ids.jobDryRun,
      tenant_id: TENANT_A,
      entity_type: 'SUPPLIER_PRICE_LIST',
      status: 'DRY_RUN_DONE',
      file_name: 'not-applied.csv',
      appliedAt: null,
      totals_json: { rows: 5 },
      options_json: { vendor_id: ids.vendorA },
    },
    {
      id: ids.jobCustomer,
      tenant_id: TENANT_A,
      entity_type: 'CUSTOMER',
      status: 'APPLIED',
      file_name: 'customers.csv',
      appliedAt: at('2026-07-01T09:00:00.000Z'),
      totals_json: { rows: 50 },
      options_json: {},
    },
    {
      id: ids.jobOther,
      tenant_id: TENANT_B,
      entity_type: 'SUPPLIER_PRICE_LIST',
      status: 'APPLIED',
      file_name: 'other-tenant.csv',
      appliedAt: at('2026-09-20T09:00:00.000Z'),
      totals_json: { rows: 9 },
      options_json: { vendor_id: ids.vendorB },
    },
  ];

  const marginRules: Row[] = [
    {
      id: ids.ruleBrake,
      tenant_id: TENANT_A,
      name: 'Brake parts 35%',
      priority: 10,
      is_active: true,
      brand_id: 4,
      revenue_group_id: 2,
      cost_min: dec('0'),
      cost_max: dec('50'),
      markup_percent: dec('35'),
      use_supplier_rrp: false,
      rounding: 'ROUND_90',
    },
    {
      id: ids.ruleRrp,
      tenant_id: TENANT_A,
      name: 'Supplier RRP',
      priority: 10,
      is_active: true,
      brand_id: null,
      revenue_group_id: null,
      cost_min: null,
      cost_max: null,
      markup_percent: null,
      use_supplier_rrp: true,
      rounding: 'NONE',
    },
    {
      id: ids.ruleFallback,
      tenant_id: TENANT_A,
      name: 'Fallback 40%',
      priority: 20,
      is_active: false,
      brand_id: null,
      revenue_group_id: null,
      cost_min: null,
      cost_max: null,
      markup_percent: dec('40'),
      use_supplier_rrp: false,
      rounding: 'WHOLE_EURO',
    },
    {
      id: ids.ruleOther,
      tenant_id: TENANT_B,
      name: 'Other tenant rule',
      priority: 1,
      is_active: true,
      brand_id: null,
      revenue_group_id: null,
      cost_min: null,
      cost_max: null,
      markup_percent: dec('99'),
      use_supplier_rrp: false,
      rounding: 'NONE',
    },
  ];

  const priceHistory: Row[] = [1, 2, 3, 4, 5, 6].map((day) => ({
    id: `00000000-0000-4000-8000-0000000000${day}0`,
    tenant_id: TENANT_A,
    catalog_item_id: ids.brake1,
    createdAt: at(`2026-0${day}-01T08:00:00.000Z`),
    old_cost: day === 1 ? null : dec(String(day)),
    new_cost: dec(String(day + 1)),
    old_retail: null,
    new_retail: dec(String(day + 10)),
    import_job_id: ids.jobSep,
  }));

  const vendors: Row[] = [
    { id: ids.vendorA, tenant_id: TENANT_A, name: 'Supplier GmbH' },
    { id: ids.vendorB, tenant_id: TENANT_B, name: 'Other vendor' },
  ];

  const vendorArticles: Row[] = [
    {
      id: '00000000-0000-4000-8000-0000000000e5',
      tenant_id: TENANT_A,
      catalog_item_id: ids.brake1,
      vendor_id: ids.vendorA,
      vendor_article_no: 'SUP-77',
      last_cost: dec('7.4'),
      last_rrp: null,
      updatedAt: at('2026-09-15T10:00:00.000Z'),
    },
    {
      id: '00000000-0000-4000-8000-0000000000e6',
      tenant_id: TENANT_B,
      catalog_item_id: ids.otherBrake,
      vendor_id: ids.vendorB,
      vendor_article_no: 'OTHER-1',
      last_cost: dec('0.5'),
      last_rrp: null,
      updatedAt: at('2026-09-15T10:00:00.000Z'),
    },
  ];

  const brands: Row[] = [
    brandNamed(4, 'Acme Parts', TENANT_A),
    brandNamed(5, 'Other brand', TENANT_B),
  ];
  const revenueGroups: Row[] = [
    { id: 2, tenant_id: TENANT_A, name: 'Parts 20%', tax_rate: dec('20') },
    { id: 7, tenant_id: TENANT_B, name: 'Other group', tax_rate: dec('10') },
  ];

  const location = (
    id: string,
    code: string,
    type: string,
    deletedAt: Date | null,
    siteId: string,
  ) => ({
    id,
    code,
    name: `Location ${code}`,
    type,
    deletedAt,
    tenant_id: TENANT_A,
    site_id: siteId,
  });
  const stockRow = (
    id: string,
    loc: Row,
    quantity: string,
    siteId: string,
  ): Row => ({
    id,
    tenant_id: TENANT_A,
    site_id: siteId,
    catalog_item_id: ids.brake1,
    location_id: loc.id,
    location: loc,
    quantity_on_hand: dec(quantity),
  });
  const inventoryStocks: Row[] = [
    stockRow(
      ids.binFull,
      location(ids.binFull, 'A-01-03', 'bin', null, SITE_A),
      '4',
      SITE_A,
    ),
    stockRow(
      ids.binEmpty,
      location(ids.binEmpty, 'A-01-04', 'bin', null, SITE_A),
      '0',
      SITE_A,
    ),
    stockRow(
      ids.binOther,
      location(ids.binOther, 'A-02-01', 'bin', null, SITE_A),
      '9',
      SITE_A,
    ),
    stockRow(
      ids.binWarehouse,
      location(ids.binWarehouse, 'WH-1', 'warehouse', null, SITE_A),
      '50',
      SITE_A,
    ),
    stockRow(
      ids.binDeleted,
      location(
        ids.binDeleted,
        'A-09-09',
        'bin',
        at('2026-01-01T00:00:00.000Z'),
        SITE_A,
      ),
      '100',
      SITE_A,
    ),
    stockRow(
      '00000000-0000-4000-8000-0000000000a5',
      location(
        '00000000-0000-4000-8000-0000000000b0',
        'B-01-01',
        'bin',
        null,
        SITE_B,
      ),
      '200',
      SITE_B,
    ),
  ];

  // An item whose only stock row holds nothing: it has no default bin.
  const zeroStockLocation = location(
    '00000000-0000-4000-8000-0000000000b4',
    'W-01-01',
    'bin',
    null,
    SITE_A,
  );
  inventoryStocks.push({
    id: '00000000-0000-4000-8000-0000000000a6',
    tenant_id: TENANT_A,
    site_id: SITE_A,
    catalog_item_id: ids.wiper,
    location_id: zeroStockLocation.id,
    location: zeroStockLocation,
    quantity_on_hand: dec('0'),
  });

  return {
    catalogItems: parts,
    laborOperations,
    importJobs,
    marginRules,
    catalogPriceHistory: priceHistory,
    vendor: vendors,
    vendorArticle: vendorArticles,
    brand: brands,
    revenueGroup: revenueGroups,
    inventoryStock: inventoryStocks,
  };
}

function createService(
  overrides: {
    siteId?: string | null;
    tables?: ReturnType<typeof buildTables>;
  } = {},
) {
  const tables = overrides.tables ?? buildTables();
  const prisma = {
    catalogItem: delegate(tables.catalogItems),
    laborOperation: delegate(tables.laborOperations),
    importJob: delegate(tables.importJobs),
    marginRule: delegate(tables.marginRules),
    catalogPriceHistory: delegate(tables.catalogPriceHistory),
    vendor: delegate(tables.vendor),
    vendorArticle: delegate(tables.vendorArticle),
    brand: delegate(tables.brand),
    revenueGroup: delegate(tables.revenueGroup),
    inventoryStock: delegate(tables.inventoryStock),
  };
  const tenantContext = {
    getTenantId: jest.fn(async () => TENANT_A),
  } as unknown as TenantContextService;
  const siteContext = {
    findSiteId: jest.fn(async () =>
      overrides.siteId === undefined ? SITE_A : overrides.siteId,
    ),
  } as unknown as SiteContextService;
  const service = new McpCatalogReadService(
    prisma as unknown as PrismaService,
    siteContext,
    tenantContext,
  );
  return { service, prisma, tables };
}

const skus = (page: { data: Array<{ sku: string }> }) =>
  page.data.map((row) => row.sku);

describe('McpCatalogReadService', () => {
  describe('list_catalog_items', () => {
    it('lists parts in SKU order with the compact row fields and EUR prices, never another tenant', async () => {
      const { service } = createService();

      const page = await service.listCatalogItems({});

      expect(skus(page)).toEqual([
        'BRK-100',
        'BRK-101',
        'FLT-200',
        'FLT-201',
        'WPR-300',
      ]);
      expect(page.data[0]).toEqual({
        id: ids.brake1,
        sku: 'BRK-100',
        name: 'Brake pad set',
        type: 'part',
        unit: 'pcs',
        price_net: '12.50',
      });
      expect(page.data.some((row) => row.sku === 'BRK-999')).toBe(false);
      expect(page.data.every((row) => !('cost_price' in row))).toBe(true);
    });

    it('filters by query across SKU, name, and EAN, case-insensitively', async () => {
      const { service } = createService();

      expect(skus(await service.listCatalogItems({ query: 'brk' }))).toEqual([
        'BRK-100',
        'BRK-101',
      ]);
      expect(skus(await service.listCatalogItems({ query: 'OIL' }))).toEqual([
        'FLT-200',
        'FLT-201',
      ]);
      expect(
        skus(await service.listCatalogItems({ query: '4006381' })),
      ).toEqual(['BRK-100']);
      expect(
        skus(await service.listCatalogItems({ query: 'nothing-matches' })),
      ).toEqual([]);
    });

    it('filters active parts: active excludes superseded items, and active false lists only them', async () => {
      const { service } = createService();

      expect(
        skus(await service.listCatalogItems({ active: true })),
      ).not.toContain('FLT-200');
      expect(skus(await service.listCatalogItems({ active: false }))).toEqual([
        'FLT-200',
      ]);
    });

    it('lists labor operations under their code, priced per hour, when type is labor', async () => {
      const { service } = createService();

      const page = await service.listCatalogItems({ type: 'labor' });

      expect(page.data).toEqual([
        {
          id: ids.oilLabor,
          sku: 'OIL-SERVICE',
          name: 'Oil service',
          type: 'labor',
          unit: 'h',
          price_net: '95.00',
        },
        {
          id: ids.retiredLabor,
          sku: 'OLD-JOB',
          name: 'Retired job',
          type: 'labor',
          unit: 'h',
          price_net: '80.00',
        },
      ]);
      expect(page.data.every((row) => row.id !== ids.otherLabor)).toBe(true);
    });

    it('walks every labor operation of this tenant once across pages of one, in code order', async () => {
      const { service } = createService();
      const codes: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.listCatalogItems({
          type: 'labor',
          pageSize: 1,
          ...(cursor ? { cursor } : {}),
        });
        codes.push(...skus(page));
        cursor = page.meta.next_cursor ?? undefined;
      } while (cursor);

      expect(codes).toEqual(['OIL-SERVICE', 'OLD-JOB']);
    });

    it('filters labor by active flag and by query on code or description', async () => {
      const { service } = createService();

      const active = await service.listCatalogItems({
        type: 'labor',
        active: true,
      });
      const byText = await service.listCatalogItems({
        type: 'labor',
        query: 'retired',
      });

      expect(active.data.map((row) => row.sku)).toEqual(['OIL-SERVICE']);
      expect(byText.data.map((row) => row.sku)).toEqual(['OLD-JOB']);
    });

    it('walks every part exactly once across pages of two, with no gaps or repeats', async () => {
      const { service } = createService();
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.listCatalogItems({
          pageSize: 2,
          ...(cursor ? { cursor } : {}),
        });
        expect(page.meta.page_size).toBe(2);
        expect(page.data.length).toBeLessThanOrEqual(2);
        seen.push(...skus(page));
        cursor = page.meta.next_cursor ?? undefined;
      } while (cursor);

      expect(seen).toEqual([
        'BRK-100',
        'BRK-101',
        'FLT-200',
        'FLT-201',
        'WPR-300',
      ]);
    });

    it('returns a null cursor on the last page and uses ten rows by default', async () => {
      const { service } = createService();

      const page = await service.listCatalogItems({});

      expect(page.meta).toEqual({ page_size: 10, next_cursor: null });
    });

    it('caps a page at the requested size and leaves the remaining rows to the next page', async () => {
      const tables = buildTables();
      for (let index = 0; index < 30; index += 1) {
        tables.catalogItems.push({
          id: `00000000-0000-4000-8000-000000001${String(index).padStart(3, '0')}`,
          tenant_id: TENANT_A,
          sku: `BULK-${String(index).padStart(3, '0')}`,
          name: `Bulk ${index}`,
          unit: 'pcs',
          ean: null,
          cost_price: null,
          retail_price: dec('1'),
          oem_numbers: null,
          superseded_by_id: null,
          brand_id: null,
          revenue_group_id: null,
        });
      }
      const { service } = createService({ tables });

      const first = await service.listCatalogItems({ pageSize: 25 });
      const second = await service.listCatalogItems({
        pageSize: 25,
        cursor: first.meta.next_cursor!,
      });

      expect(first.data).toHaveLength(25);
      expect(first.meta.next_cursor).not.toBeNull();
      expect(second.data).toHaveLength(10);
      expect(second.meta.next_cursor).toBeNull();
      const allSkus = [...skus(first), ...skus(second)];
      expect(new Set(allSkus).size).toBe(allSkus.length);
    });

    it('rejects a cursor from another list type or one that is not a cursor', async () => {
      const { service } = createService();
      const partCursor = encodeMcpPositionCursor({
        type: 'part',
        key: 'BRK-100',
        id: ids.brake1,
      });

      await expect(
        service.listCatalogItems({ type: 'labor', cursor: partCursor }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.listCatalogItems({ cursor: 'not a cursor!' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('get_catalog_item', () => {
    it('returns details with the tax class, brand, supplier numbers, and EUR cost and price', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.brake1 });

      expect(detail).toMatchObject({
        id: ids.brake1,
        sku: 'BRK-100',
        name: 'Brake pad set',
        unit: 'pcs',
        ean: '4006381333931',
        active: true,
        cost_price: '7.40',
        price_net: '12.50',
        brand: { id: 4, name: 'Acme Parts' },
        tax_class: {
          revenue_group_id: 2,
          name: 'Parts 20%',
          tax_rate: '20.00',
        },
        oem_numbers: ['1K0698451'],
      });
    });

    it('returns the five newest price history rows, newest first, with EUR strings', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.brake1 });

      expect(detail.price_history).toHaveLength(5);
      expect(detail.price_history[0]).toMatchObject({
        at: '2026-06-01T08:00:00.000Z',
        old_cost: '6.00',
        new_cost: '7.00',
        old_retail: null,
        new_retail: '16.00',
        import_job_id: ids.jobSep,
      });
      expect(detail.price_history.map((row) => row.at)).toEqual(
        [...detail.price_history.map((row) => row.at)].sort().reverse(),
      );
    });

    it('names the default bin as the bin at the active site with the most stock, skipping empty, non-bin, deleted, and other-site stock', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.brake1 });

      expect(detail.default_bin).toEqual({
        location_id: ids.binOther,
        code: 'A-02-01',
        name: 'Location A-02-01',
        quantity_on_hand: 9,
      });
    });

    it('reports no default bin when no active site is set, and still returns the item', async () => {
      const { service } = createService({ siteId: null });

      const detail = await service.getCatalogItem({ id: ids.brake1 });

      expect(detail.default_bin).toBeNull();
      expect(detail.sku).toBe('BRK-100');
    });

    it('names the vendor article updated most recently as the default vendor, with its last cost', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.brake1 });

      expect(detail.default_vendor).toEqual({
        vendor_id: ids.vendorA,
        name: 'Supplier GmbH',
        vendor_article_no: 'SUP-77',
        last_cost: '7.40',
        last_rrp: null,
      });
    });

    it('reports a superseded item as inactive and names its replacement', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.oilOld });

      expect(detail.active).toBe(false);
      expect(detail.superseded_by).toEqual({
        id: ids.oilNew,
        sku: 'FLT-201',
        name: 'Oil filter (new)',
      });
    });

    it('returns a null cost price for an item with none stored', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.brake2 });

      expect(detail.cost_price).toBeNull();
      expect(detail.default_vendor).toBeNull();
      expect(detail.default_bin).toBeNull();
    });

    it('reports no default bin for an item whose only bin stock is zero', async () => {
      const { service } = createService();

      const detail = await service.getCatalogItem({ id: ids.wiper });

      expect(detail.default_bin).toBeNull();
      expect(detail.sku).toBe('WPR-300');
    });

    it("is not found for another tenant's item, and for a labor operation ID", async () => {
      const { service } = createService();

      await expect(
        service.getCatalogItem({ id: ids.otherBrake }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getCatalogItem({ id: ids.oilLabor }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list_price_lists', () => {
    it('lists applied supplier price lists of this tenant, newest first, with vendor, valid_from, and items_count', async () => {
      const { service } = createService();

      const page = await service.listPriceLists({});

      expect(page.data).toEqual([
        {
          id: ids.jobSep,
          name: 'supplier-sep.csv',
          vendor: { id: ids.vendorA, name: 'Supplier GmbH' },
          valid_from: '2026-09-15T10:00:00.000Z',
          items_count: 412,
        },
        {
          id: ids.jobAug,
          name: 'supplier-aug.csv',
          vendor: { id: ids.vendorA, name: 'Supplier GmbH' },
          valid_from: '2026-08-01T09:00:00.000Z',
          items_count: 120,
        },
      ]);
    });

    it('pages with a keyset cursor over the applied time, with no gaps or repeats', async () => {
      const { service } = createService();

      const first = await service.listPriceLists({ pageSize: 1 });
      const second = await service.listPriceLists({
        pageSize: 1,
        cursor: first.meta.next_cursor!,
      });

      expect(first.data.map((row) => row.id)).toEqual([ids.jobSep]);
      expect(second.data.map((row) => row.id)).toEqual([ids.jobAug]);
      expect(second.meta.next_cursor).toBeNull();
    });

    it('pages through price lists that share an applied time, by ID, with no gaps or repeats', async () => {
      const tables = buildTables();
      tables.importJobs.push({
        id: ids.jobTie,
        tenant_id: TENANT_A,
        entity_type: 'SUPPLIER_PRICE_LIST',
        status: 'APPLIED',
        file_name: 'supplier-sep-same-time.csv',
        appliedAt: at('2026-09-15T10:00:00.000Z'),
        totals_json: { rows: 7 },
        options_json: {},
      });
      const { service } = createService({ tables });
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.listPriceLists({
          pageSize: 1,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.data.map((row) => row.id));
        cursor = page.meta.next_cursor ?? undefined;
      } while (cursor);

      expect(seen).toEqual([ids.jobSep, ids.jobTie, ids.jobAug]);
    });

    it('rejects a cursor that is not a position cursor', async () => {
      const { service } = createService();

      await expect(
        service.listPriceLists({ cursor: 'bad cursor!' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a keyset cursor from another list, such as list_invoices', async () => {
      const { service } = createService();
      const invoiceCursor = encodeMcpKeysetCursor({
        at: '2026-09-15T10:00:00.000Z',
        id: ids.jobSep,
      });

      await expect(
        service.listPriceLists({ cursor: invoiceCursor }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list_margin_rules', () => {
    it('lists only the active rules of this tenant, by priority, with scope, markup, and rounding', async () => {
      const { service } = createService();

      const page = await service.listMarginRules({});

      expect(page.data.map((row) => row.id)).toEqual([
        ids.ruleBrake,
        ids.ruleRrp,
      ]);
      expect(page.data[0]).toEqual({
        id: ids.ruleBrake,
        scope: {
          brand: { id: 4, name: 'Acme Parts' },
          revenue_group: { id: 2, name: 'Parts 20%' },
          cost_min: '0.00',
          cost_max: '50.00',
        },
        markup: { percent: '35.00', use_supplier_rrp: false },
        rounding: 'ROUND_90',
      });
      expect(page.data.map((row) => row.id)).not.toContain(ids.ruleFallback);
      expect(page.data.map((row) => row.id)).not.toContain(ids.ruleOther);
    });

    it('rejects a priority beyond the 32-bit range in the cursor', async () => {
      const { service } = createService();
      const cursor = encodeMcpPositionCursor({
        priority: 2147483648,
        id: ids.ruleBrake,
      });

      await expect(service.listMarginRules({ cursor })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('shows a supplier RRP rule with no markup percent', async () => {
      const { service } = createService();

      const page = await service.listMarginRules({});

      expect(page.data[1].markup).toEqual({
        percent: null,
        use_supplier_rrp: true,
      });
    });

    it('pages with a keyset cursor over priority and ID, with no gaps or repeats', async () => {
      const { service } = createService();
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.listMarginRules({
          pageSize: 1,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.data.map((row) => row.id));
        cursor = page.meta.next_cursor ?? undefined;
      } while (cursor);

      expect(seen).toEqual([ids.ruleBrake, ids.ruleRrp]);
    });

    it('rejects a cursor whose position is not a priority and ID', async () => {
      const { service } = createService();
      const badCursor = encodeMcpKeysetCursor({
        at: '2026-01-01T00:00:00.000Z',
        id: ids.ruleBrake,
      });

      await expect(
        service.listMarginRules({ cursor: badCursor }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('page size', () => {
    it('caps every list at 25 rows in the service, whatever pageSize asks for', async () => {
      const { service } = createService();

      expect(
        (await service.listCatalogItems({ pageSize: 100 })).meta.page_size,
      ).toBe(25);
      expect(
        (await service.listCatalogItems({ type: 'labor', pageSize: 100 })).meta
          .page_size,
      ).toBe(25);
      expect(
        (await service.listPriceLists({ pageSize: 100 })).meta.page_size,
      ).toBe(25);
      expect(
        (await service.listMarginRules({ pageSize: 100 })).meta.page_size,
      ).toBe(25);
    });
  });

  describe('tenant isolation', () => {
    it('filters every read by the session tenant, so no query runs without tenant_id', async () => {
      const { service, prisma } = createService();

      await service.listCatalogItems({});
      await service.listCatalogItems({ type: 'labor' });
      await service.getCatalogItem({ id: ids.brake1 });
      await service.listPriceLists({});
      await service.listMarginRules({});

      const calls = Object.values(prisma).flatMap((delegateFns) => [
        ...delegateFns.findMany.mock.calls,
        ...delegateFns.findFirst.mock.calls,
      ]);
      expect(calls.length).toBeGreaterThan(0);
      for (const [args] of calls) {
        expect(args?.where).toEqual(
          expect.objectContaining({ tenant_id: TENANT_A }),
        );
      }
    });

    it('scopes the default bin to the active site and the tenant', async () => {
      const { service, prisma } = createService();

      await service.getCatalogItem({ id: ids.brake1 });

      expect(prisma.inventoryStock.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: TENANT_A,
            site_id: SITE_A,
          }),
        }),
      );
    });
  });
});
