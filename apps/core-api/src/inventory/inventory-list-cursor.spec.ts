import { resolveInventoryCursorSort } from './inventory-list-cursor.js';

describe('resolveInventoryCursorSort', () => {
  it('returns BadRequest for cursor-disabled sort fields', () => {
    expect(() => resolveInventoryCursorSort('status', 'asc')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'LIST_CURSOR_SORT_UNSUPPORTED',
        }),
      }),
    );
  });
});
