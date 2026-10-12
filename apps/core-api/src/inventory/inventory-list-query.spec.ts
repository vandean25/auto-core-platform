import {
  buildInventoryOrderBy,
  parsePositiveInt,
  parseSortDirection,
} from './inventory-list-query.js';

describe('inventory list query helpers', () => {
  it('parses positive integers and falls back otherwise', () => {
    expect(parsePositiveInt('2', 1)).toBe(2);
    expect(parsePositiveInt('0', 1)).toBe(1);
    expect(parsePositiveInt('abc', 10)).toBe(10);
    expect(parsePositiveInt(undefined)).toBeUndefined();
  });

  it('accepts only asc or desc as a sort direction', () => {
    expect(parseSortDirection('asc')).toBe('asc');
    expect(parseSortDirection('desc')).toBe('desc');
    expect(parseSortDirection('sideways')).toBeUndefined();
    expect(parseSortDirection(undefined)).toBeUndefined();
  });

  it('orders by sortable catalog columns with a stable id tie-breaker', () => {
    expect(buildInventoryOrderBy('sku', 'desc')).toEqual([{ sku: 'desc' }, { id: 'asc' }]);
    expect(buildInventoryOrderBy('name', 'asc')).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(buildInventoryOrderBy('price', 'desc')).toEqual([
      { retail_price: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('defaults to ascending when no direction is given', () => {
    expect(buildInventoryOrderBy('sku')).toEqual([{ sku: 'asc' }, { id: 'asc' }]);
  });

  it('returns no ordering for derived or unknown columns', () => {
    expect(buildInventoryOrderBy('status', 'asc')).toBeUndefined();
    expect(buildInventoryOrderBy('warehouse_location', 'asc')).toBeUndefined();
    expect(buildInventoryOrderBy(undefined, 'asc')).toBeUndefined();
  });
});
