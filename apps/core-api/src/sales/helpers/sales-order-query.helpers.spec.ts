import { SalesOrderStatus } from '@prisma/client';
import {
  findDefaultSalesOrders,
  findPaginatedSalesOrders,
  isSalesOrderFindManyArgs,
  toPublicSalesOrder,
} from './sales-order-query.helpers';

describe('sales-order-query.helpers', () => {
  describe('isSalesOrderFindManyArgs', () => {
    it('detects prisma query objects', () => {
      expect(isSalesOrderFindManyArgs({ where: { status: 'DRAFT' } })).toBe(
        true,
      );
      expect(isSalesOrderFindManyArgs({ skip: 0 })).toBe(true);
      expect(isSalesOrderFindManyArgs({ orderBy: { createdAt: 'desc' } })).toBe(
        true,
      );
    });

    it('rejects status strings and empty objects', () => {
      expect(isSalesOrderFindManyArgs(SalesOrderStatus.DRAFT)).toBe(false);
      expect(isSalesOrderFindManyArgs(undefined)).toBe(false);
      expect(isSalesOrderFindManyArgs({})).toBe(false);
    });
  });

  describe('toPublicSalesOrder', () => {
    it('strips vehicle identity resolution state', () => {
      const order = toPublicSalesOrder({
        id: 'so-1',
        vehicle: {
          id: 'vehicle-1',
          identity_resolution_generation: 'generation-1',
          identity_resolution_token: 'token-1',
        },
      } as never);

      expect(order.vehicle).not.toHaveProperty(
        'identity_resolution_generation',
      );
      expect(order.vehicle).not.toHaveProperty('identity_resolution_token');
    });
  });

  describe('findPaginatedSalesOrders', () => {
    const prisma = {
      salesOrder: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('scopes tenant and returns paginated results', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([
        {
          id: 'so-1',
          vehicle: {
            id: 'vehicle-1',
            identity_resolution_generation: 'generation-1',
            identity_resolution_token: 'token-1',
          },
        },
      ]);
      prisma.salesOrder.count.mockResolvedValue(1);

      const result = await findPaginatedSalesOrders(prisma as never, 'tenant-1', {
        where: { status: SalesOrderStatus.DRAFT },
        skip: 0,
        take: 10,
      });

      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: SalesOrderStatus.DRAFT, tenant_id: 'tenant-1' },
        }),
      );
      expect(result.total).toBe(1);
      expect(result.data[0].vehicle).not.toHaveProperty(
        'identity_resolution_generation',
      );
    });
  });

  describe('findDefaultSalesOrders', () => {
    const prisma = {
      salesOrder: {
        findMany: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('filters by status when provided', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([{ id: 'so-1', vehicle: null }]);

      const result = await findDefaultSalesOrders(
        prisma as never,
        'tenant-1',
        SalesOrderStatus.CONFIRMED,
      );

      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-1',
            status: SalesOrderStatus.CONFIRMED,
          },
        }),
      );
      expect(result.total).toBe(1);
    });

    it('returns all tenant orders when status is omitted', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([]);

      await findDefaultSalesOrders(prisma as never, 'tenant-1');

      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-1' },
        }),
      );
    });
  });
});
