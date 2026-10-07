import {
  getCustomerInputSchema,
  getStockLevelInputSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
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

  it('validates stock age report filters and page size', () => {
    expect(getVehicleStockAgeReportInputSchema.parse({
      inventory_role: 'USED', bucket: 'over_90', page_size: 25,
    })).toEqual({ inventory_role: 'USED', bucket: 'over_90', page_size: 25 });
    expect(() => getVehicleStockAgeReportInputSchema.parse({ page_size: 26 })).toThrow();
  });

  it('validates ISO dates for the margin report', () => {
    expect(getVehicleStockMarginReportInputSchema.parse({
      from: '2026-10-01', to: '2026-10-31',
    })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(() => getVehicleStockMarginReportInputSchema.parse({
      from: 'October', to: '2026-10-31',
    })).toThrow();
  });
});
