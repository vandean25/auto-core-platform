import { SalesOrderStatus } from '@prisma/client';
import {
  buildSalesOrderListWhere,
  resolveSalesOrderCursorRequest,
  resolveSalesOrderCursorLimit,
  resolveSalesOrderCursorSort,
  salesOrderListFilterContext,
} from './sales-order-list-cursor.js';

describe('sales order list cursor helpers', () => {
  it.each([
    [undefined, undefined, 'createdAt', 'desc'],
    ['createdAt', undefined, 'createdAt', 'asc'],
    ['createdAt', 'desc', 'createdAt', 'desc'],
    ['order_number', undefined, 'order_number', 'asc'],
    ['order_number', 'desc', 'order_number', 'desc'],
  ])(
    'WHEN sort is (%s, %s) THEN the cursor sort is %s %s (newest first without a sort)',
    (sortField, sortDirection, field, direction) => {
      expect(
        resolveSalesOrderCursorSort(
          sortField,
          sortDirection as 'asc' | 'desc' | undefined,
        ),
      ).toMatchObject({ field, direction });
    },
  );

  it.each([
    ['status', undefined],
    ['total_amount', undefined],
    ['customer', undefined],
    ['customer.last_name', undefined],
    ['customer.company_name', undefined],
    ['constructor', undefined],
    ['__proto__', undefined],
    [undefined, 'asc'],
    [undefined, 'desc'],
    ['createdAt', 'sideways'],
  ])(
    'WHEN sort is (%s, %s) THEN it is rejected with LIST_CURSOR_SORT_UNSUPPORTED',
    (sortField, sortDirection) => {
      expect(() =>
        resolveSalesOrderCursorSort(sortField, sortDirection),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'LIST_CURSOR_SORT_UNSUPPORTED',
          }),
        }),
      );
    },
  );

  it.each([
    [{ page: '2' }],
    [{ pageSize: '10' }],
    [{ params: JSON.stringify({ page: 2 }) }],
    [{ params: JSON.stringify({ pageSize: 10 }) }],
    [{ status: 'CONFIRMED', params: JSON.stringify({ page: 1 }) }],
  ])(
    'WHEN offset pagination param is sent (%j) THEN it is rejected with LIST_CURSOR_PARAM_FORBIDDEN',
    (query) => {
      expect(() => resolveSalesOrderCursorRequest(query)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'LIST_CURSOR_PARAM_FORBIDDEN',
          }),
        }),
      );
    },
  );

  it.each([
    [{ params: 'not-json' }],
    [{ params: '[]' }],
    [{ params: JSON.stringify({ filters: [{ field: 'status', operator: 'equals', value: 'DRAFT' }] }) }],
    [{ params: JSON.stringify({ search: 'abc' }) }],
    [{ params: JSON.stringify({ sorting: [{ field: 'createdAt', direction: 'asc' }] }) }],
    [{ params: JSON.stringify({ extra: true }) }],
    [{ params: JSON.stringify({ filters: 'bad' }), status: 'DRAFT' }],
  ])(
    'WHEN params remain effective, unknown, or ambiguous (%j) THEN it is rejected with LIST_PARAMS_UNSUPPORTED',
    (query) => {
      expect(() => resolveSalesOrderCursorRequest(query)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'LIST_PARAMS_UNSUPPORTED',
          }),
        }),
      );
    },
  );

  it('WHEN flat status, search, or sortField overrides params THEN overridden params components are accepted', () => {
    const resolved = resolveSalesOrderCursorRequest({
      status: 'CONFIRMED',
      search: 'Meier',
      sortField: 'order_number',
      sortDirection: 'asc',
      params: JSON.stringify({
        filters: [{ field: 'status', operator: 'equals', value: 'DRAFT' }],
        search: 'Other',
        sorting: [{ field: 'total_amount', direction: 'desc' }],
      }),
    });

    expect(resolved.status).toBe(SalesOrderStatus.CONFIRMED);
    expect(resolved.search).toBe('Meier');
    expect(resolved.sort).toMatchObject({
      field: 'order_number',
      direction: 'asc',
    });
  });

  it.each(['', 'OPEN', 'CANCELLED', 'draft'])(
    'WHEN status is %s (not in SalesOrderStatus) THEN it is rejected with LIST_STATUS_INVALID',
    (status) => {
      expect(() => resolveSalesOrderCursorRequest({ status })).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'LIST_STATUS_INVALID',
          }),
        }),
      );
    },
  );

  it('keeps whitespace-only search literal in both where and filterHashInput', () => {
    const query = { search: '   ', status: 'DRAFT' };
    const resolved = resolveSalesOrderCursorRequest(query);
    expect(salesOrderListFilterContext(resolved)).toEqual({
      search: '   ',
      status: SalesOrderStatus.DRAFT,
    });
    const where = buildSalesOrderListWhere('tenant-1', 'site-1', resolved);
    expect(where).toMatchObject({
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      status: SalesOrderStatus.DRAFT,
      OR: [
        { order_number: { contains: '   ', mode: 'insensitive' } },
        { customer: { last_name: { contains: '   ', mode: 'insensitive' } } },
        { customer: { company_name: { contains: '   ', mode: 'insensitive' } } },
      ],
    });
  });

  it.each([
    [undefined, 25],
    ['abc', 25],
    ['0', 1],
    ['40', 40],
    ['500', 100],
  ])('WHEN limit is %s THEN the effective limit is %d', (limit, expected) => {
    expect(resolveSalesOrderCursorLimit(limit)).toBe(expected);
  });
});
