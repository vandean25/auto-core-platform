import { QueryBuilder } from './query-builder';

describe('QueryBuilder', () => {
  describe('buildWhere', () => {
    it('builds whitelisted filters with supported operators', () => {
      const where = QueryBuilder.buildWhere(
        [
          { field: 'name', operator: 'equals', value: 'ACME' },
          { field: 'code', operator: 'contains', value: 'A1' },
          { field: 'sku', operator: 'startsWith', value: 'SKU-' },
          { field: 'serial', operator: 'endsWith', value: '-X' },
          { field: 'price', operator: 'gt', value: 10 },
          { field: 'qty', operator: 'gte', value: 5 },
          { field: 'discount', operator: 'lt', value: 20 },
          { field: 'tax', operator: 'lte', value: 7 },
          { field: 'status', operator: 'in', value: ['ACTIVE', 'PENDING'] },
          { field: 'archived', operator: 'notIn', value: [true] },
          { field: 'ignored', operator: 'equals', value: 'skip-me' },
        ],
        [
          'name',
          'code',
          'sku',
          'serial',
          'price',
          'qty',
          'discount',
          'tax',
          'status',
          'archived',
        ],
      );

      expect(where).toEqual({
        name: { equals: 'ACME' },
        code: { contains: 'A1', mode: 'insensitive' },
        sku: { startsWith: 'SKU-', mode: 'insensitive' },
        serial: { endsWith: '-X', mode: 'insensitive' },
        price: { gt: 10 },
        qty: { gte: 5 },
        discount: { lt: 20 },
        tax: { lte: 7 },
        status: { in: ['ACTIVE', 'PENDING'] },
        archived: { notIn: [true] },
      });
      expect(where).not.toHaveProperty('ignored');
    });

    it('normalizes scalar values for in/notIn operators', () => {
      const where = QueryBuilder.buildWhere(
        [
          { field: 'status', operator: 'in', value: 'ACTIVE' },
          { field: 'archived', operator: 'notIn', value: false },
        ],
        ['status', 'archived'],
      );

      expect(where).toEqual({
        status: { in: ['ACTIVE'] },
        archived: { notIn: [false] },
      });
    });

    it('falls back to equals for unsupported operators', () => {
      const where = QueryBuilder.buildWhere(
        [
          {
            field: 'name',
            operator: 'unsupported' as any,
            value: 'fallback',
          },
        ],
        ['name'],
      );

      expect(where).toEqual({
        name: { equals: 'fallback' },
      });
    });

    it('builds nested field filters', () => {
      const where = QueryBuilder.buildWhere(
        [{ field: 'customer.name', operator: 'contains', value: 'john' }],
        ['customer.name'],
      );

      expect(where).toEqual({
        customer: {
          name: { contains: 'john', mode: 'insensitive' },
        },
      });
    });

    it('builds global search for flat and nested fields', () => {
      const where = QueryBuilder.buildWhere(
        [],
        [],
        'abc',
        ['invoiceNumber', 'customer.name'],
      );

      expect(where).toEqual({
        OR: [
          { invoiceNumber: { contains: 'abc', mode: 'insensitive' } },
          { customer: { name: { contains: 'abc', mode: 'insensitive' } } },
        ],
      });
    });

    it('combines explicit filters and global search using AND with OR', () => {
      const where = QueryBuilder.buildWhere(
        [
          { field: 'status', operator: 'equals', value: 'OPEN' },
          { field: 'customer.name', operator: 'startsWith', value: 'A' },
        ],
        ['status', 'customer.name'],
        'INV',
        ['invoiceNumber', 'customer.email'],
      );

      expect(where).toEqual({
        AND: [
          {
            status: { equals: 'OPEN' },
            customer: {
              name: { startsWith: 'A', mode: 'insensitive' },
            },
          },
          {
            OR: [
              { invoiceNumber: { contains: 'INV', mode: 'insensitive' } },
              {
                customer: {
                  email: { contains: 'INV', mode: 'insensitive' },
                },
              },
            ],
          },
        ],
      });
      expect(where).not.toHaveProperty('status');
      expect(where).not.toHaveProperty('customer');
    });
  });

  describe('buildOrderBy', () => {
    it('builds sorting for flat and nested fields, respecting whitelist', () => {
      const orderBy = QueryBuilder.buildOrderBy(
        [
          { field: 'createdAt', direction: 'desc' },
          { field: 'customer.name', direction: 'asc' },
          { field: 'ignored', direction: 'asc' },
        ],
        ['createdAt', 'customer.name'],
      );

      expect(orderBy).toEqual([
        { createdAt: 'desc' },
        { customer: { name: 'asc' } },
      ]);
    });

    it('returns undefined when no whitelisted sort is provided', () => {
      const orderBy = QueryBuilder.buildOrderBy(
        [{ field: 'ignored', direction: 'asc' }],
        ['createdAt'],
      );

      expect(orderBy).toBeUndefined();
    });
  });

  describe('buildPagination', () => {
    it('returns default pagination values', () => {
      expect(QueryBuilder.buildPagination()).toEqual({ skip: 0, take: 25 });
    });

    it('clamps page and pageSize boundaries', () => {
      expect(QueryBuilder.buildPagination(0, 0)).toEqual({ skip: 0, take: 1 });
      expect(QueryBuilder.buildPagination(2, 200)).toEqual({
        skip: 100,
        take: 100,
      });
    });
  });

  describe('buildPrismaQuery', () => {
    it('returns a complete prisma query object', () => {
      const query = QueryBuilder.buildPrismaQuery(
        {
          filters: [
            { field: 'status', operator: 'equals', value: 'OPEN' },
            { field: 'customer.name', operator: 'contains', value: 'jo' },
          ],
          sorting: [
            { field: 'createdAt', direction: 'desc' },
            { field: 'customer.name', direction: 'asc' },
          ],
          page: 2,
          pageSize: 200,
          search: 'INV-',
        },
        ['status', 'customer.name', 'createdAt'],
        ['invoiceNumber', 'customer.email'],
      );

      expect(query).toEqual({
        where: {
          AND: [
            {
              status: { equals: 'OPEN' },
              customer: { name: { contains: 'jo', mode: 'insensitive' } },
            },
            {
              OR: [
                { invoiceNumber: { contains: 'INV-', mode: 'insensitive' } },
                {
                  customer: {
                    email: { contains: 'INV-', mode: 'insensitive' },
                  },
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { customer: { name: 'asc' } }],
        skip: 100,
        take: 100,
      });
    });
  });
});
