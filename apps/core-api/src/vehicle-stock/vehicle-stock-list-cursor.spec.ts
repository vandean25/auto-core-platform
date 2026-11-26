import { VehicleStockStatus } from '@prisma/client';
import { resolveVehicleStockCursorSort } from './vehicle-stock-list-cursor.js';

describe('resolveVehicleStockCursorSort', () => {
  it('resolves stock_status as a nullable enum cursor sort', () => {
    expect(resolveVehicleStockCursorSort('stock_status', 'asc')).toEqual({
      field: 'stock_status',
      direction: 'asc',
      config: {
        prismaField: 'stock_status',
        valueKind: 'enum',
        nullable: true,
        enumOrder: Object.values(VehicleStockStatus),
      },
    });
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
