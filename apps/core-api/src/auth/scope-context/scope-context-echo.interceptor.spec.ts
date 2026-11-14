import { describe, expect, it } from '@jest/globals';
import { SCOPE_CONTEXT_ECHO_PATHS } from './scope-context.constants.js';

describe('ScopeContext echo routes (AUT-937)', () => {
  it('lists every cursor list and capped-count echo path', () => {
    expect(SCOPE_CONTEXT_ECHO_PATHS).toEqual([
      '/api/inventory',
      '/api/inventory/capped-count',
      '/api/sales/invoices',
      '/api/sales/invoices/capped-count',
      '/api/vehicle-stock',
      '/api/vehicle-stock/capped-count',
      '/api/workshop/orders',
      '/api/workshop/orders/capped-count',
    ]);
  });
});
