import { Prisma } from '@prisma/client';
import {
  MCP_PRICE_HISTORY_LIMIT,
  toMcpCatalogItemDetail,
  toMcpLaborListRow,
  toMcpListPage,
  toMcpMarginRuleRow,
  toMcpPartListRow,
  toMcpPriceListRow,
  vendorIdOfPriceList,
} from './mcp-catalog-read.mapper.js';

const ITEM_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000c2';
const VENDOR_ID = '00000000-0000-4000-8000-0000000000f1';
const JOB_ID = '00000000-0000-4000-8000-0000000000b1';

const dec = (value: string) => new Prisma.Decimal(value);

describe('MCP catalog and price read mappers', () => {
  describe('list rows', () => {
    it('lists a part with exactly the compact row fields and a two-place EUR price', () => {
      const row = toMcpPartListRow({
        id: ITEM_ID,
        sku: 'BRK-PAD-001',
        name: 'Brake pad set',
        unit: 'pcs',
        retail_price: dec('12.5'),
      });

      expect(row).toEqual({
        id: ITEM_ID,
        sku: 'BRK-PAD-001',
        name: 'Brake pad set',
        type: 'part',
        unit: 'pcs',
        price_net: '12.50',
      });
      expect(Object.keys(row).sort()).toEqual(
        ['id', 'name', 'price_net', 'sku', 'type', 'unit'].sort(),
      );
    });

    it('never puts a cost price in a list row', () => {
      const row = toMcpPartListRow({
        id: ITEM_ID,
        sku: 'X-1',
        name: 'Filter',
        unit: 'pcs',
        retail_price: dec('3'),
      });

      expect(row).not.toHaveProperty('cost_price');
      expect(row.price_net).toBe('3.00');
    });

    it('lists a labor operation under its code, priced per hour', () => {
      const row = toMcpLaborListRow({
        id: OTHER_ID,
        code: 'OIL-SERVICE',
        description: 'Oil service',
        hourly_rate: dec('95'),
      });

      expect(row).toEqual({
        id: OTHER_ID,
        sku: 'OIL-SERVICE',
        name: 'Oil service',
        type: 'labor',
        unit: 'h',
        price_net: '95.00',
      });
    });
  });

  describe('catalog item detail', () => {
    const baseItem = {
      id: ITEM_ID,
      sku: 'BRK-PAD-001',
      name: 'Brake pad set',
      unit: 'pcs',
      ean: '4006381333931',
      cost_price: dec('7.4'),
      retail_price: dec('12.5'),
      oem_numbers: ['1K0698451', 42, '1K0698451B'],
      superseded_by_id: null,
    };
    const emptyRelated = {
      brand: null,
      revenueGroup: null,
      supersededBy: null,
      defaultBin: null,
      defaultVendor: null,
      priceHistory: [],
    };

    it('reports an item that is not superseded as active, with cost and price as EUR strings', () => {
      const detail = toMcpCatalogItemDetail(baseItem, emptyRelated);

      expect(detail.active).toBe(true);
      expect(detail.cost_price).toBe('7.40');
      expect(detail.price_net).toBe('12.50');
      expect(detail.ean).toBe('4006381333931');
    });

    it('reports a superseded item as inactive and names its replacement', () => {
      const detail = toMcpCatalogItemDetail(
        { ...baseItem, superseded_by_id: OTHER_ID },
        {
          ...emptyRelated,
          supersededBy: { id: OTHER_ID, sku: 'BRK-PAD-002', name: 'Pad set' },
        },
      );

      expect(detail.active).toBe(false);
      expect(detail.superseded_by).toEqual({
        id: OTHER_ID,
        sku: 'BRK-PAD-002',
        name: 'Pad set',
      });
    });

    it('returns a null cost price when none is stored', () => {
      const detail = toMcpCatalogItemDetail(
        { ...baseItem, cost_price: null },
        emptyRelated,
      );

      expect(detail.cost_price).toBeNull();
    });

    it('reports the tax class from the revenue group, with its tax rate as a two-place string', () => {
      const detail = toMcpCatalogItemDetail(baseItem, {
        ...emptyRelated,
        revenueGroup: { id: 3, name: 'Standard 20%', tax_rate: dec('20') },
      });

      expect(detail.tax_class).toEqual({
        revenue_group_id: 3,
        name: 'Standard 20%',
        tax_rate: '20.00',
      });
    });

    it('keeps only string supplier numbers, and at most 20 of them', () => {
      const many = Array.from({ length: 30 }, (_, index) => `OEM-${index}`);
      const detail = toMcpCatalogItemDetail(
        {
          ...baseItem,
          oem_numbers: [...many, 7],
        },
        emptyRelated,
      );

      expect(detail.oem_numbers).toHaveLength(20);
      expect(
        detail.oem_numbers.every((entry) => typeof entry === 'string'),
      ).toBe(true);
      expect(detail.oem_numbers[0]).toBe('OEM-0');
    });

    it('gives an empty supplier number list for a non-array value', () => {
      const detail = toMcpCatalogItemDetail(
        { ...baseItem, oem_numbers: { any: 'object' } },
        emptyRelated,
      );

      expect(detail.oem_numbers).toEqual([]);
    });

    it('reports the default bin with its on-hand quantity and the default vendor with cost and RRP', () => {
      const detail = toMcpCatalogItemDetail(baseItem, {
        ...emptyRelated,
        defaultBin: {
          quantity_on_hand: dec('4.000'),
          location: { id: OTHER_ID, code: 'A-01-03', name: 'Aisle 1 bin 3' },
        },
        defaultVendor: {
          vendor: { id: VENDOR_ID, name: 'Supplier GmbH' },
          vendor_article_no: 'SUP-77',
          last_cost: dec('7.4'),
          last_rrp: null,
        },
      });

      expect(detail.default_bin).toEqual({
        location_id: OTHER_ID,
        code: 'A-01-03',
        name: 'Aisle 1 bin 3',
        quantity_on_hand: 4,
      });
      expect(detail.default_vendor).toEqual({
        vendor_id: VENDOR_ID,
        name: 'Supplier GmbH',
        vendor_article_no: 'SUP-77',
        last_cost: '7.40',
        last_rrp: null,
      });
    });

    it('maps each price history row to ISO time and EUR strings, with nulls kept', () => {
      const detail = toMcpCatalogItemDetail(baseItem, {
        ...emptyRelated,
        priceHistory: [
          {
            createdAt: new Date('2026-10-01T08:00:00.000Z'),
            old_cost: null,
            new_cost: dec('7.4'),
            old_retail: null,
            new_retail: dec('12.5'),
            import_job_id: JOB_ID,
          },
        ],
      });

      expect(detail.price_history).toEqual([
        {
          at: '2026-10-01T08:00:00.000Z',
          old_cost: null,
          new_cost: '7.40',
          old_retail: null,
          new_retail: '12.50',
          import_job_id: JOB_ID,
        },
      ]);
    });

    it('states the price history limit as five rows', () => {
      expect(MCP_PRICE_HISTORY_LIMIT).toBe(5);
    });
  });

  describe('price lists', () => {
    const applied = new Date('2026-09-15T10:30:00.000Z');

    it('shows the file name, the vendor, the applied time as valid_from, and the imported row count', () => {
      const row = toMcpPriceListRow(
        {
          id: JOB_ID,
          file_name: 'supplier-2026-09.csv',
          appliedAt: applied,
          totals_json: { rows: 412, create: 3, update: 400, skip: 9, error: 0 },
          options_json: { vendor_id: VENDOR_ID },
        },
        { id: VENDOR_ID, name: 'Supplier GmbH' },
      );

      expect(row).toEqual({
        id: JOB_ID,
        name: 'supplier-2026-09.csv',
        vendor: { id: VENDOR_ID, name: 'Supplier GmbH' },
        valid_from: '2026-09-15T10:30:00.000Z',
        items_count: 412,
      });
    });

    it('reports a null vendor and zero items for malformed import data', () => {
      const row = toMcpPriceListRow(
        {
          id: JOB_ID,
          file_name: 'legacy.csv',
          appliedAt: applied,
          totals_json: { rows: 'many' },
          options_json: null,
        },
        null,
      );

      expect(row.vendor).toBeNull();
      expect(row.items_count).toBe(0);
    });

    it('reads the vendor ID only when the import options carry a non-empty string', () => {
      expect(vendorIdOfPriceList({ vendor_id: VENDOR_ID })).toBe(VENDOR_ID);
      expect(vendorIdOfPriceList({ vendor_id: '' })).toBeNull();
      expect(vendorIdOfPriceList({ vendor_id: 12 })).toBeNull();
      expect(vendorIdOfPriceList(null)).toBeNull();
      expect(vendorIdOfPriceList(['x'])).toBeNull();
    });
  });

  describe('margin rules', () => {
    const baseRule = {
      id: ITEM_ID,
      name: 'Brake parts 35%',
      priority: 10,
      is_active: true,
      cost_min: dec('0'),
      cost_max: dec('50'),
      markup_percent: dec('35'),
      use_supplier_rrp: false,
      rounding: 'ROUND_90',
    };

    it('shows the scope as brand, revenue group, and EUR cost bracket, with the markup and rounding', () => {
      const row = toMcpMarginRuleRow(baseRule, {
        brand: { id: 4, name: 'Acme Parts' },
        revenueGroup: { id: 2, name: 'Parts' },
      });

      expect(row).toEqual({
        id: ITEM_ID,
        name: 'Brake parts 35%',
        priority: 10,
        active: true,
        scope: {
          brand: { id: 4, name: 'Acme Parts' },
          revenue_group: { id: 2, name: 'Parts' },
          cost_min: '0.00',
          cost_max: '50.00',
        },
        markup: { percent: '35.00', use_supplier_rrp: false },
        rounding: 'ROUND_90',
      });
    });

    it('shows an open scope and a supplier RRP rule with no markup percent', () => {
      const row = toMcpMarginRuleRow(
        {
          ...baseRule,
          cost_min: null,
          cost_max: null,
          markup_percent: null,
          use_supplier_rrp: true,
          rounding: 'NONE',
          is_active: false,
        },
        { brand: null, revenueGroup: null },
      );

      expect(row.scope).toEqual({
        brand: null,
        revenue_group: null,
        cost_min: null,
        cost_max: null,
      });
      expect(row.markup).toEqual({ percent: null, use_supplier_rrp: true });
      expect(row.active).toBe(false);
    });
  });

  describe('list pages', () => {
    const records = ['a', 'b', 'c'];
    const cursorOf = (record: string) => `cursor-${record}`;
    const mapRow = (record: string) => record.toUpperCase();

    it('returns no next cursor on the last page', () => {
      const page = toMcpListPage(records, 3, { cursorOf, mapRow });

      expect(page).toEqual({
        data: ['A', 'B', 'C'],
        meta: { page_size: 3, next_cursor: null },
      });
    });

    it('drops the extra probe row and points the cursor at the last row kept', () => {
      const page = toMcpListPage(records, 2, { cursorOf, mapRow });

      expect(page.data).toEqual(['A', 'B']);
      expect(page.meta).toEqual({ page_size: 2, next_cursor: 'cursor-b' });
    });

    it('returns an empty page without a cursor when there are no rows', () => {
      const page = toMcpListPage([], 10, { cursorOf, mapRow });

      expect(page).toEqual({
        data: [],
        meta: { page_size: 10, next_cursor: null },
      });
    });
  });
});
