import {
  encodeMcpKeysetCursor,
  encodeMcpPositionCursor,
} from './mcp-output.util.js';
import {
  getCatalogItemInputSchema,
  listCatalogItemsInputSchema,
  listMarginRulesInputSchema,
  listPriceListsInputSchema,
  mcpToolInputSchemas,
} from './mcp-tool-schemas.js';

const ITEM_ID = '00000000-0000-4000-8000-0000000000c1';
const RULE_ID = '00000000-0000-4000-8000-0000000000a1';

describe('catalog and price read input schemas (AUT-460)', () => {
  describe('list_catalog_items', () => {
    it('caps pageSize at 25 and rejects 0 and 26', () => {
      expect(
        listCatalogItemsInputSchema.safeParse({ pageSize: 25 }).success,
      ).toBe(true);
      expect(
        listCatalogItemsInputSchema.safeParse({ pageSize: 26 }).success,
      ).toBe(false);
      expect(
        listCatalogItemsInputSchema.safeParse({ pageSize: 0 }).success,
      ).toBe(false);
    });

    it('accepts only the part and labor types', () => {
      expect(
        listCatalogItemsInputSchema.safeParse({ type: 'part' }).success,
      ).toBe(true);
      expect(
        listCatalogItemsInputSchema.safeParse({ type: 'labor' }).success,
      ).toBe(true);
      expect(
        listCatalogItemsInputSchema.safeParse({ type: 'service' }).success,
      ).toBe(false);
    });

    it('trims the query and rejects an empty or over-long one', () => {
      expect(
        listCatalogItemsInputSchema.parse({ query: '  brk  ' }).query,
      ).toBe('brk');
      expect(
        listCatalogItemsInputSchema.safeParse({ query: '   ' }).success,
      ).toBe(false);
      expect(
        listCatalogItemsInputSchema.safeParse({ query: 'x'.repeat(101) })
          .success,
      ).toBe(false);
    });

    it('takes a boolean active flag', () => {
      expect(
        listCatalogItemsInputSchema.safeParse({ active: false }).success,
      ).toBe(true);
      expect(
        listCatalogItemsInputSchema.safeParse({ active: 'yes' }).success,
      ).toBe(false);
    });

    it('accepts a position cursor from meta.next_cursor and rejects other cursors', () => {
      const position = encodeMcpPositionCursor({
        type: 'part',
        key: 'BRK-100',
        id: ITEM_ID,
      });

      expect(
        listCatalogItemsInputSchema.safeParse({ cursor: position }).success,
      ).toBe(true);
      expect(
        listCatalogItemsInputSchema.safeParse({
          cursor: encodeMcpKeysetCursor({
            at: '2026-01-01T00:00:00.000Z',
            id: ITEM_ID,
          }),
        }).success,
      ).toBe(false);
      expect(
        listCatalogItemsInputSchema.safeParse({ cursor: 'not a cursor!' })
          .success,
      ).toBe(false);
      expect(
        listCatalogItemsInputSchema.safeParse({
          cursor: encodeMcpPositionCursor({
            type: 'part',
            key: 'BRK-100',
            id: 'not-a-uuid',
          }),
        }).success,
      ).toBe(false);
    });
  });

  describe('get_catalog_item', () => {
    it('requires a UUID id', () => {
      expect(getCatalogItemInputSchema.safeParse({ id: ITEM_ID }).success).toBe(
        true,
      );
      expect(
        getCatalogItemInputSchema.safeParse({ id: 'BRK-100' }).success,
      ).toBe(false);
      expect(getCatalogItemInputSchema.safeParse({}).success).toBe(false);
    });

    it('describes the ID as a part ID from list_catalog_items', () => {
      expect(getCatalogItemInputSchema.shape.id.description).toMatch(
        /list_catalog_items/,
      );
    });
  });

  describe('list_price_lists', () => {
    it('caps pageSize at 25', () => {
      expect(
        listPriceListsInputSchema.safeParse({ pageSize: 25 }).success,
      ).toBe(true);
      expect(
        listPriceListsInputSchema.safeParse({ pageSize: 26 }).success,
      ).toBe(false);
    });

    it('takes only its own position cursor, not a keyset cursor from another list or a priority cursor', () => {
      expect(
        listPriceListsInputSchema.safeParse({
          cursor: encodeMcpPositionCursor({
            applied_at: '2026-09-15T10:00:00.000Z',
            id: ITEM_ID,
          }),
        }).success,
      ).toBe(true);
      expect(
        listPriceListsInputSchema.safeParse({
          cursor: encodeMcpKeysetCursor({
            at: '2026-09-15T10:00:00.000Z',
            id: ITEM_ID,
          }),
        }).success,
      ).toBe(false);
      expect(
        listPriceListsInputSchema.safeParse({
          cursor: encodeMcpPositionCursor({ priority: 10, id: ITEM_ID }),
        }).success,
      ).toBe(false);
    });
  });

  describe('list_margin_rules', () => {
    it('caps pageSize at 25 and takes a priority and ID cursor', () => {
      expect(
        listMarginRulesInputSchema.safeParse({ pageSize: 25 }).success,
      ).toBe(true);
      expect(
        listMarginRulesInputSchema.safeParse({ pageSize: 26 }).success,
      ).toBe(false);
      expect(
        listMarginRulesInputSchema.safeParse({
          cursor: encodeMcpPositionCursor({ priority: 10, id: RULE_ID }),
        }).success,
      ).toBe(true);
      expect(
        listMarginRulesInputSchema.safeParse({
          cursor: encodeMcpPositionCursor({
            priority: 2147483647,
            id: RULE_ID,
          }),
        }).success,
      ).toBe(true);
      expect(
        listMarginRulesInputSchema.safeParse({
          cursor: encodeMcpPositionCursor({
            priority: 2147483648,
            id: RULE_ID,
          }),
        }).success,
      ).toBe(false);
      expect(
        listMarginRulesInputSchema.safeParse({
          cursor: encodeMcpKeysetCursor({
            at: '2026-09-15T10:00:00.000Z',
            id: RULE_ID,
          }),
        }).success,
      ).toBe(false);
    });
  });

  it('registers an input schema for each of the four catalog and price tools', () => {
    for (const name of [
      'list_catalog_items',
      'get_catalog_item',
      'list_price_lists',
      'list_margin_rules',
    ]) {
      expect(mcpToolInputSchemas).toHaveProperty(name);
    }
  });
});
