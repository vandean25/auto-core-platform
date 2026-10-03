import {
  getCustomerInputSchema,
  getStockLevelInputSchema,
  searchCustomersInputSchema,
} from './mcp-tool-schemas.js';

describe('MCP tool input schemas', () => {
  it('validates search_customers paging bounds', () => {
    expect(
      searchCustomersInputSchema.parse({ page: 1, page_size: 25 }),
    ).toEqual({ page: 1, page_size: 25 });
    expect(() => searchCustomersInputSchema.parse({ page_size: 26 })).toThrow();
  });

  it('validates get_customer uuid', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(getCustomerInputSchema.parse({ customer_id: id })).toEqual({
      customer_id: id,
    });
  });

  it('requires catalog_item_id or sku for get_stock_level', () => {
    expect(() => getStockLevelInputSchema.parse({})).toThrow();
    expect(
      getStockLevelInputSchema.parse({ sku: 'MPN-1' }),
    ).toEqual({ sku: 'MPN-1' });
  });
});
