import {
  buildInvoiceListWhere,
  invoiceListFilterContext,
  resolveInvoiceCursorLimit,
  resolveInvoiceCursorSort,
} from './invoice-list-cursor.js';

describe('invoice list cursor helpers', () => {
  it.each([
    [undefined, undefined, 'date', 'desc'],
    ['date', undefined, 'date', 'asc'],
    ['invoice_number', 'desc', 'invoice_number', 'desc'],
  ])(
    'WHEN sort is (%s, %s) THEN the cursor sort is %s %s (newest first without a sort)',
    (sortField, sortDirection, field, direction) => {
      expect(
        resolveInvoiceCursorSort(
          sortField,
          sortDirection as 'asc' | 'desc' | undefined,
        ),
      ).toMatchObject({ field, direction });
    },
  );

  it('WHEN the sort is the nullable number THEN the keyset treats null numbers (drafts) as a separate tail', () => {
    expect(resolveInvoiceCursorSort('invoice_number').config.nullable).toBe(
      true,
    );
    expect(resolveInvoiceCursorSort('date').config.nullable).toBe(false);
  });

  it.each(['customer', 'status', 'total_gross', 'constructor', '__proto__'])(
    'WHEN the sort is %s THEN it is rejected with LIST_CURSOR_SORT_UNSUPPORTED',
    (sortField) => {
      expect(() => resolveInvoiceCursorSort(sortField)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'LIST_CURSOR_SORT_UNSUPPORTED',
          }),
        }),
      );
    },
  );

  it.each([
    [undefined, 25],
    ['abc', 25],
    ['0', 1],
    ['40', 40],
    ['500', 100],
  ])('WHEN limit is %s THEN the effective limit is %d', (limit, expected) => {
    expect(resolveInvoiceCursorLimit(limit)).toBe(expected);
  });

  it('WHEN there is no search THEN the where clause is only the tenant filter', () => {
    expect(buildInvoiceListWhere('tenant-1', { search: '  ' })).toEqual({
      tenant_id: 'tenant-1',
    });
  });

  it('WHEN the search has two words THEN every word must hit the customer and the tenant is repeated on the relation', () => {
    const where = buildInvoiceListWhere('tenant-1', { search: 'erika muster' });

    expect(where.tenant_id).toBe('tenant-1');
    const customerBranch = (where.OR ?? [])[1] as {
      customer: { is: { tenant_id: string; AND: unknown[] } };
    };
    expect(customerBranch.customer.is.tenant_id).toBe('tenant-1');
    expect(customerBranch.customer.is.AND).toHaveLength(2);
  });

  it('WHEN the search matches an invoice status THEN the status is searched, otherwise it is not', () => {
    const withStatus = buildInvoiceListWhere('t', { search: 'pai' });
    const withoutStatus = buildInvoiceListWhere('t', { search: 'RE-2026' });

    expect(withStatus.OR).toContainEqual({ status: { in: ['PAID'] } });
    expect(withoutStatus.OR).toHaveLength(2);
  });

  it('WHEN the search only differs in surrounding blanks THEN the cursor filter context is equal', () => {
    expect(invoiceListFilterContext({ search: ' RE ' })).toEqual(
      invoiceListFilterContext({ search: 'RE' }),
    );
  });
});
