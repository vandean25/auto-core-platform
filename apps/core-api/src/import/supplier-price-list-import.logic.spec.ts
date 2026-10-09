import { ImportRowAction } from '@prisma/client';
import {
  normalizeSupplierPriceListRow,
  planSupplierPriceListDryRunRow,
  type SupplierPriceListMatchContext,
  type SupplierPriceListCatalogItem,
} from './supplier-price-list-import.logic.js';
import type { MarginRuleItem } from '../margin-rule/retail-from-cost.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

const mapping = {
  supplier_article_no: 'Lieferanten-Artikelnummer',
  ean: 'EAN',
  description: 'Beschreibung',
  brand: 'Marke',
  cost_price: 'Einkaufspreis',
  rrp: 'UVP',
  unit: 'Einheit',
};

describe('supplier-price-list-import.logic', () => {
  describe('normalizeSupplierPriceListRow', () => {
    it('normalizes valid German CSV row with German numbers', () => {
      const record = {
        'Lieferanten-Artikelnummer': 'SUPP-001',
        EAN: '4012345678901',
        Beschreibung: 'Bremsscheibe Belüftet',
        Marke: 'Brembo',
        Einkaufspreis: '1.234,50',
        UVP: '1.500,00',
        Einheit: 'Stk',
      };

      const result = normalizeSupplierPriceListRow(record, mapping);

      expect(result.issues).toEqual([]);
      expect(result.row).toEqual({
        supplier_article_no: 'SUPP-001',
        ean: '4012345678901',
        description: 'Bremsscheibe Belüftet',
        brand: 'Brembo',
        cost_price: 1234.5,
        rrp: 1500,
        unit: 'Stk',
      });
    });

    it('returns error when supplier article number is missing', () => {
      const record = {
        'Lieferanten-Artikelnummer': '  ',
        EAN: '4012345678901',
        Beschreibung: 'Bremsscheibe',
        Einkaufspreis: '45,00',
      };

      const result = normalizeSupplierPriceListRow(record, mapping);

      expect(result.row).toBeNull();
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('IMPORT_SUPPLIER_ARTICLE_NO_REQUIRED');
      expect(result.issues[0].field).toBe('supplier_article_no');
    });

    it('returns error when cost price is missing or invalid number', () => {
      const record = {
        'Lieferanten-Artikelnummer': 'ART-123',
        Beschreibung: 'Ölfilter',
        Einkaufspreis: 'ungültig',
      };

      const result = normalizeSupplierPriceListRow(record, mapping);

      expect(result.row).toBeNull();
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('IMPORT_INVALID_COST_PRICE');
      expect(result.issues[0].field).toBe('cost_price');
    });

    it('returns error when cost price is zero or negative', () => {
      const record = {
        'Lieferanten-Artikelnummer': 'ART-123',
        Beschreibung: 'Ölfilter',
        Einkaufspreis: '-10,50',
      };

      const result = normalizeSupplierPriceListRow(record, mapping);

      expect(result.row).toBeNull();
      expect(result.issues[0].code).toBe('IMPORT_INVALID_COST_PRICE');
    });

    it('returns error when description is missing', () => {
      const record = {
        'Lieferanten-Artikelnummer': 'ART-123',
        Beschreibung: '',
        Einkaufspreis: '15,00',
      };

      const result = normalizeSupplierPriceListRow(record, mapping);

      expect(result.row).toBeNull();
      expect(result.issues[0].code).toBe('IMPORT_DESCRIPTION_REQUIRED');
      expect(result.issues[0].field).toBe('description');
    });
  });

  describe('Match Order: (1) EAN -> (2) Vendor article mapping -> (3) SKU', () => {
    const itemByEan: SupplierPriceListCatalogItem = {
      id: 'item-ean-1',
      sku: 'SKU-EAN-1',
      name: 'Item Matched By EAN',
      cost_price: 50,
      retail_price: 80,
      ean: '4012345678901',
    };

    const itemByVendorArticle: SupplierPriceListCatalogItem = {
      id: 'item-vendor-2',
      sku: 'SKU-VENDOR-2',
      name: 'Item Matched By Vendor Article No',
      cost_price: 50,
      retail_price: 80,
      ean: null,
    };

    const itemBySku: SupplierPriceListCatalogItem = {
      id: 'item-sku-3',
      sku: 'SUPP-ART-100',
      name: 'Item Matched By SKU',
      cost_price: 50,
      retail_price: 80,
      ean: null,
    };

    const createContext = (): SupplierPriceListMatchContext => ({
      catalogItemByEan: new Map([['4012345678901', itemByEan]]),
      catalogItemByVendorArticleNo: new Map([
        ['SUPP-ART-100', itemByVendorArticle],
      ]),
      catalogItemBySku: new Map([['SUPP-ART-100', itemBySku]]),
    });

    it('matches by EAN (priority 1) when EAN is present, even if vendor article and SKU would match different items', () => {
      const context = createContext();
      const row = {
        supplier_article_no: 'SUPP-ART-100',
        ean: '4012345678901',
        description: 'Test Part',
        brand: null,
        cost_price: 55,
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.UPDATE);
      expect(planned.entity_id).toBe('item-ean-1');
      expect(planned.normalized?.match_method).toBe('EAN');
    });

    it('matches by vendor article number (priority 2) when EAN is absent or not found', () => {
      const context = createContext();
      const row = {
        supplier_article_no: 'SUPP-ART-100',
        ean: '9999999999999', // EAN does not match any item
        description: 'Test Part',
        brand: null,
        cost_price: 55,
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.UPDATE);
      expect(planned.entity_id).toBe('item-vendor-2');
      expect(planned.normalized?.match_method).toBe('VENDOR_ARTICLE_NO');
    });

    it('matches by SKU (priority 3) when EAN and vendor article number are not found', () => {
      const context: SupplierPriceListMatchContext = {
        catalogItemByEan: new Map(),
        catalogItemByVendorArticleNo: new Map(),
        catalogItemBySku: new Map([['SUPP-ART-100', itemBySku]]),
      };
      const row = {
        supplier_article_no: 'SUPP-ART-100',
        ean: null,
        description: 'Test Part',
        brand: null,
        cost_price: 55,
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.UPDATE);
      expect(planned.entity_id).toBe('item-sku-3');
      expect(planned.normalized?.match_method).toBe('SKU');
    });
  });

  describe('Action Planning: UPDATE, SKIP, CREATE, ERROR', () => {
    const existingItem: SupplierPriceListCatalogItem = {
      id: 'existing-1',
      sku: 'SKU-001',
      name: 'Existing Catalog Item',
      cost_price: 100,
      retail_price: 150,
      ean: '4000000000001',
    };

    const context: SupplierPriceListMatchContext = {
      catalogItemByEan: new Map([['4000000000001', existingItem]]),
      catalogItemByVendorArticleNo: new Map(),
      catalogItemBySku: new Map(),
    };

    it('plans UPDATE when matched item has cost difference', () => {
      const row = {
        supplier_article_no: 'ART-1',
        ean: '4000000000001',
        description: 'Updated Cost Item',
        brand: null,
        cost_price: 110, // Changed from 100 to 110
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.UPDATE);
      expect(planned.entity_id).toBe('existing-1');
      expect(planned.normalized?.cost_price).toBe(110);
    });

    it('plans UPDATE when matched item has retail difference from margin rule', () => {
      const marginRules: MarginRuleItem[] = [
        {
          priority: 1,
          markup_percent: 60, // 100 * 1.6 = 160 (retail changes from 150 to 160)
          rounding: 'NONE',
          is_active: true,
        },
      ];
      const contextWithRules: SupplierPriceListMatchContext = {
        ...context,
        marginRules,
      };

      const row = {
        supplier_article_no: 'ART-1',
        ean: '4000000000001',
        description: 'Updated Retail Item',
        brand: null,
        cost_price: 100, // Unchanged cost
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, contextWithRules);

      expect(planned.action).toBe(ImportRowAction.UPDATE);
      expect(planned.entity_id).toBe('existing-1');
      expect(planned.normalized?.retail_price).toBe(160);
    });

    it('plans SKIP (unchanged) when matched item has identical cost and retail prices', () => {
      const row = {
        supplier_article_no: 'ART-1',
        ean: '4000000000001',
        description: 'Unchanged Item',
        brand: null,
        cost_price: 100, // Identical to existing 100
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.SKIP);
      expect(planned.entity_id).toBe('existing-1');
      expect(planned.errors).toEqual([]);
    });

    it('plans CREATE when item is unmatched and create_new_catalog_items is true', () => {
      const row = {
        supplier_article_no: 'NEW-ART-999',
        ean: '4099999999999',
        description: 'New Brand Item',
        brand: 'Bosch',
        cost_price: 25.5,
        rrp: 40.0,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context, {
        create_new_catalog_items: true,
      });

      expect(planned.action).toBe(ImportRowAction.CREATE);
      expect(planned.entity_id).toBeNull();
      expect(planned.normalized?.cost_price).toBe(25.5);
      expect(planned.normalized?.supplier_article_no).toBe('NEW-ART-999');
    });

    it('plans SKIP with warning when item is unmatched and create_new_catalog_items is false', () => {
      const row = {
        supplier_article_no: 'UNMATCHED-123',
        ean: '4099999999999',
        description: 'Unmatched Item',
        brand: null,
        cost_price: 25.5,
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context, {
        create_new_catalog_items: false,
      });

      expect(planned.action).toBe(ImportRowAction.SKIP);
      expect(planned.entity_id).toBeNull();
      expect(planned.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Artikel nicht im Katalog gefunden und Neuanlage ist deaktiviert',
          }),
        ]),
      );
    });

    it('plans ERROR when row is invalid (null row or invalid cost/article)', () => {
      const planned = planSupplierPriceListDryRunRow(
        1,
        null,
        context,
        {},
        [],
        [
          {
            code: 'IMPORT_INVALID_COST_PRICE',
            message: 'Invalid cost price',
            field: 'cost_price',
          },
        ],
      );

      expect(planned.action).toBe(ImportRowAction.ERROR);
      expect(planned.errors).toHaveLength(1);
      expect(planned.errors[0].code).toBe('IMPORT_INVALID_COST_PRICE');
    });
  });

  describe('Price Jump Flagging (> threshold)', () => {
    const existingItem: SupplierPriceListCatalogItem = {
      id: 'item-jump-1',
      sku: 'SKU-JUMP',
      name: 'Item for Price Jump Test',
      cost_price: 100,
      retail_price: 150,
      ean: '4011111111111',
    };

    const context: SupplierPriceListMatchContext = {
      catalogItemByEan: new Map([['4011111111111', existingItem]]),
      catalogItemByVendorArticleNo: new Map(),
      catalogItemBySku: new Map(),
      priceJumpThresholdPercent: 20,
    };

    it('flags row with PRICE_JUMP_EXCEEDED when cost change > 20%', () => {
      const row = {
        supplier_article_no: 'ART-JUMP',
        ean: '4011111111111',
        description: 'Price Jump Item',
        brand: null,
        cost_price: 125, // 25% increase > 20%
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.UPDATE);
      expect(planned.normalized?.price_jump_flagged).toBe(true);
      expect(planned.normalized?.cost_change_percent).toBe(25);
      expect(planned.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PRICE_JUMP_EXCEEDED',
          }),
        ]),
      );
    });

    it('flags row with PRICE_JUMP_EXCEEDED when cost drops > 20%', () => {
      const row = {
        supplier_article_no: 'ART-JUMP',
        ean: '4011111111111',
        description: 'Price Drop Item',
        brand: null,
        cost_price: 75, // 25% drop > 20%
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.normalized?.price_jump_flagged).toBe(true);
      expect(planned.normalized?.cost_change_percent).toBe(-25);
      expect(planned.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PRICE_JUMP_EXCEEDED',
          }),
        ]),
      );
    });

    it('does NOT flag when cost change is <= 20%', () => {
      const row = {
        supplier_article_no: 'ART-JUMP',
        ean: '4011111111111',
        description: 'Moderate Increase Item',
        brand: null,
        cost_price: 120, // Exactly 20% increase <= 20%
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.normalized?.price_jump_flagged).toBe(false);
      expect(planned.normalized?.cost_change_percent).toBe(20);
      expect(
        planned.warnings.some((w) => w.code === 'PRICE_JUMP_EXCEEDED'),
      ).toBe(false);
    });

    it('respects custom threshold percent from options', () => {
      const row = {
        supplier_article_no: 'ART-JUMP',
        ean: '4011111111111',
        description: 'Custom Threshold Item',
        brand: null,
        cost_price: 115, // 15% increase
        rrp: null,
        unit: 'pcs',
      };

      // With 10% threshold: 15% > 10% -> flagged
      const plannedFlagged = planSupplierPriceListDryRunRow(1, row, context, {
        price_jump_threshold_percent: 10,
      });
      expect(plannedFlagged.normalized?.price_jump_flagged).toBe(true);

      // With 30% threshold: 15% <= 30% -> not flagged
      const plannedNotFlagged = planSupplierPriceListDryRunRow(
        1,
        row,
        context,
        { price_jump_threshold_percent: 30 },
      );
      expect(plannedNotFlagged.normalized?.price_jump_flagged).toBe(false);
    });

    it('flags row when retail price jump > threshold via margin rule', () => {
      const marginRules: MarginRuleItem[] = [
        {
          priority: 1,
          markup_percent: 100, // Cost 100 -> retail 200. Existing retail was 150. (200-150)/150 = 33.33% > 20%
          rounding: 'NONE',
          is_active: true,
        },
      ];
      const contextWithRules: SupplierPriceListMatchContext = {
        ...context,
        marginRules,
      };

      const row = {
        supplier_article_no: 'ART-JUMP',
        ean: '4011111111111',
        description: 'Retail Jump Item',
        brand: null,
        cost_price: 100, // Cost unchanged
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, contextWithRules);

      expect(planned.normalized?.price_jump_flagged).toBe(true);
      expect(planned.normalized?.retail_change_percent).toBe(33.33);
      expect(
        planned.warnings.some((w) => w.code === 'PRICE_JUMP_EXCEEDED'),
      ).toBe(true);
    });
  });

  describe('RRP_MISSING_FOR_MARGIN_RULE (rule needs supplier UVP, row has none)', () => {
    const rrpRules: MarginRuleItem[] = [
      {
        priority: 1,
        use_supplier_rrp: true,
        markup_percent: null,
        rounding: 'NONE',
        is_active: true,
      },
    ];

    const emptyContext = (): SupplierPriceListMatchContext => ({
      catalogItemByEan: new Map(),
      catalogItemByVendorArticleNo: new Map(),
      catalogItemBySku: new Map(),
      marginRules: rrpRules,
    });

    it('warns for an unmatched new item without UVP and sets its retail price to the cost price', () => {
      const row = {
        supplier_article_no: 'NEW-NO-UVP',
        ean: null,
        description: 'New Item Without UVP',
        brand: null,
        cost_price: 40,
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, emptyContext(), {
        create_new_catalog_items: true,
      });

      expect(planned.action).toBe(ImportRowAction.CREATE);
      expect(planned.normalized?.retail_price).toBe(40);
      expect(planned.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: IMPORT_ERROR_CODES.RRP_MISSING_FOR_MARGIN_RULE,
            field: 'rrp',
          }),
        ]),
      );
    });

    it('does not warn for an unmatched new item when the UVP is present', () => {
      const row = {
        supplier_article_no: 'NEW-WITH-UVP',
        ean: null,
        description: 'New Item With UVP',
        brand: null,
        cost_price: 40,
        rrp: 79.9,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, emptyContext(), {
        create_new_catalog_items: true,
      });

      expect(planned.action).toBe(ImportRowAction.CREATE);
      expect(planned.normalized?.retail_price).toBe(79.9);
      expect(
        planned.warnings.some(
          (w) => w.code === IMPORT_ERROR_CODES.RRP_MISSING_FOR_MARGIN_RULE,
        ),
      ).toBe(false);
    });

    it('keeps the existing retail price and warns for a matched item without UVP', () => {
      const existingItem: SupplierPriceListCatalogItem = {
        id: 'item-rrp-1',
        sku: 'SKU-RRP-1',
        name: 'Existing Item',
        cost_price: 40,
        retail_price: 90,
        ean: '4022222222222',
      };
      const context: SupplierPriceListMatchContext = {
        catalogItemByEan: new Map([['4022222222222', existingItem]]),
        catalogItemByVendorArticleNo: new Map(),
        catalogItemBySku: new Map(),
        marginRules: rrpRules,
      };
      const row = {
        supplier_article_no: 'SKU-RRP-1',
        ean: '4022222222222',
        description: 'Existing Item',
        brand: null,
        cost_price: 40,
        rrp: null,
        unit: 'pcs',
      };

      const planned = planSupplierPriceListDryRunRow(1, row, context);

      expect(planned.action).toBe(ImportRowAction.SKIP);
      expect(planned.normalized?.retail_price).toBe(90);
      expect(planned.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: IMPORT_ERROR_CODES.RRP_MISSING_FOR_MARGIN_RULE,
            field: 'rrp',
          }),
        ]),
      );
    });
  });
});
