import { resolveVehicleStockCursorSort } from './vehicle-stock-list-cursor.js';

describe('resolveVehicleStockCursorSort', () => {
  it('rejects stock_status for cursor paging', () => {
    expect(() => resolveVehicleStockCursorSort('stock_status', 'asc')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'LIST_CURSOR_SORT_UNSUPPORTED',
        }),
      }),
    );
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'rejects inherited property name %s',
    (sortField) => {
      expect(() => resolveVehicleStockCursorSort(sortField, 'asc')).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'LIST_CURSOR_SORT_UNSUPPORTED',
          }),
        }),
      );
    },
  );
});
