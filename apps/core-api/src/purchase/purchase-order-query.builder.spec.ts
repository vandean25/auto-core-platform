import { PurchaseOrderQueryBuilder } from './purchase-order-query.builder';
import type { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';

describe('PurchaseOrderQueryBuilder', () => {
  describe('usesAdvancedQuery', () => {
    it('returns false when only open or all status is provided', () => {
      expect(
        PurchaseOrderQueryBuilder.usesAdvancedQuery({ status: 'open' }),
      ).toBe(false);
      expect(
        PurchaseOrderQueryBuilder.usesAdvancedQuery({ status: 'all' }),
      ).toBe(false);
      expect(PurchaseOrderQueryBuilder.usesAdvancedQuery({})).toBe(false);
    });

    it('returns true when pagination, search, sort, or concrete status is provided', () => {
      expect(
        PurchaseOrderQueryBuilder.usesAdvancedQuery({ page: 2 }),
      ).toBe(true);
      expect(
        PurchaseOrderQueryBuilder.usesAdvancedQuery({ search: 'PO-2026' }),
      ).toBe(true);
      expect(
        PurchaseOrderQueryBuilder.usesAdvancedQuery({
          sortField: 'createdAt',
        }),
      ).toBe(true);
      expect(
        PurchaseOrderQueryBuilder.usesAdvancedQuery({ status: 'DRAFT' }),
      ).toBe(true);
    });
  });

  describe('toPrismaQuery', () => {
    it('builds prisma query with status filter and pagination', () => {
      const query: FindPurchaseOrdersQueryDto = {
        status: 'SENT',
        search: 'vendor',
        page: 2,
        pageSize: 10,
        sortField: 'createdAt',
        sortDirection: 'desc',
      };

      const prismaQuery = PurchaseOrderQueryBuilder.toPrismaQuery(query);

      expect(prismaQuery.skip).toBe(10);
      expect(prismaQuery.take).toBe(10);
      expect(prismaQuery.where).toEqual({
        AND: [
          { status: { equals: 'SENT' } },
          {
            OR: [
              { order_number: { contains: 'vendor', mode: 'insensitive' } },
              {
                vendor: {
                  name: { contains: 'vendor', mode: 'insensitive' },
                },
              },
            ],
          },
        ],
      });
      expect(prismaQuery.orderBy).toEqual([{ createdAt: 'desc' }]);
    });
  });

  describe('toPaginatedResponse', () => {
    it('returns paginated metadata using query defaults', () => {
      const result = PurchaseOrderQueryBuilder.toPaginatedResponse(
        { data: [{ id: 'po-1' } as never], total: 42 },
        { page: 2, pageSize: 10 },
      );

      expect(result).toEqual({
        data: [{ id: 'po-1' }],
        meta: {
          total: 42,
          page: 2,
          pageSize: 10,
          pageCount: 5,
        },
      });
    });
  });

  describe('toLegacyPaginatedResponse', () => {
    it('returns single-page metadata for legacy list responses', () => {
      const result = PurchaseOrderQueryBuilder.toLegacyPaginatedResponse({
        data: [{ id: 'po-1' } as never, { id: 'po-2' } as never],
        total: 2,
      });

      expect(result).toEqual({
        data: [{ id: 'po-1' }, { id: 'po-2' }],
        meta: {
          total: 2,
          page: 1,
          pageSize: 2,
          pageCount: 1,
        },
      });
    });
  });
});
