import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import {
  assertSalesOrderStatusTransition,
  formatSalesOrderItem,
  persistSalesOrderUpdate,
  prepareReplacementItems,
  reconcileSalesOrderItems,
  sumSalesOrderItemTotals,
} from './sales-order-update.helpers';

describe('sales-order-update.helpers', () => {
  describe('assertSalesOrderStatusTransition', () => {
    it('allows adjacent status transitions', () => {
      expect(() =>
        assertSalesOrderStatusTransition(
          SalesOrderStatus.DRAFT,
          SalesOrderStatus.CONFIRMED,
        ),
      ).not.toThrow();
    });

    it('rejects non-adjacent status transitions', () => {
      expect(() =>
        assertSalesOrderStatusTransition(
          SalesOrderStatus.DRAFT,
          SalesOrderStatus.INVOICED,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('formatSalesOrderItem', () => {
    it('calculates line total and defaults tax rate', () => {
      const item = formatSalesOrderItem('tenant-1', {
        catalog_item_id: 'item-1',
        description: 'Oil Filter',
        quantity: 3,
        unit_price: 10,
      });

      expect(item.total).toEqual(new Prisma.Decimal(30));
      expect(item.tax_rate).toEqual(new Prisma.Decimal(20));
    });
  });

  describe('sumSalesOrderItemTotals', () => {
    it('sums item totals', () => {
      const items = [
        formatSalesOrderItem('tenant-1', {
          catalog_item_id: 'item-1',
          description: 'A',
          quantity: 2,
          unit_price: 10,
        }),
        formatSalesOrderItem('tenant-1', {
          catalog_item_id: 'item-2',
          description: 'B',
          quantity: 1,
          unit_price: 5,
        }),
      ];

      expect(sumSalesOrderItemTotals(items)).toEqual(new Prisma.Decimal(25));
    });
  });

  describe('prepareReplacementItems', () => {
    const prisma = {
      catalogItem: {
        count: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('validates catalog items and returns formatted replacement data', async () => {
      prisma.catalogItem.count.mockResolvedValue(1);

      const result = await prepareReplacementItems(prisma as never, 'tenant-1', [
        {
          catalog_item_id: 'item-1',
          description: 'Oil Filter',
          quantity: 3,
          unit_price: 10,
          tax_rate: 20,
        },
      ]);

      expect(result.totalAmount).toEqual(new Prisma.Decimal(30));
      expect(result.items[0].catalog_item_id).toBe('item-1');
    });

    it('rejects replacement items missing catalog_item_id', async () => {
      await expect(
        prepareReplacementItems(prisma as never, 'tenant-1', [
          {
            description: 'Oil Filter',
            quantity: 3,
            unit_price: 10,
            tax_rate: 20,
          },
        ]),
      ).rejects.toThrow('Each sales order item must include catalog_item_id');
    });
  });

  describe('reconcileSalesOrderItems', () => {
    const tx = {
      salesOrderItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('replaces sales order items atomically', async () => {
      const items = [
        formatSalesOrderItem('tenant-1', {
          catalog_item_id: 'item-1',
          description: 'Oil Filter',
          quantity: 2,
          unit_price: 10,
        }),
      ];

      await reconcileSalesOrderItems(tx as never, {
        salesOrderId: 'so-1',
        tenantId: 'tenant-1',
        items,
      });

      expect(tx.salesOrderItem.deleteMany).toHaveBeenCalledWith({
        where: { sales_order_id: 'so-1', tenant_id: 'tenant-1' },
      });
      expect(tx.salesOrderItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            sales_order_id: 'so-1',
            catalog_item_id: 'item-1',
          }),
        ],
      });
    });
  });

  describe('persistSalesOrderUpdate', () => {
    const tx = {
      salesOrder: {
        updateMany: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('uses guarded status update when status changes', async () => {
      tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });

      await persistSalesOrderUpdate(tx as never, {
        id: 'so-1',
        tenantId: 'tenant-1',
        currentStatus: SalesOrderStatus.DRAFT,
        nextStatus: SalesOrderStatus.CONFIRMED,
        fieldData: { notes: 'Ready' },
      });

      expect(tx.salesOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'so-1',
            tenant_id: 'tenant-1',
            status: SalesOrderStatus.DRAFT,
          },
          data: expect.objectContaining({
            status: SalesOrderStatus.CONFIRMED,
            notes: 'Ready',
          }),
        }),
      );
    });

    it('updates fields without status when status is unchanged', async () => {
      tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });

      await persistSalesOrderUpdate(tx as never, {
        id: 'so-1',
        tenantId: 'tenant-1',
        currentStatus: SalesOrderStatus.DRAFT,
        nextStatus: SalesOrderStatus.DRAFT,
        fieldData: { notes: 'Call customer' },
      });

      const data = tx.salesOrder.updateMany.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data).not.toHaveProperty('status');
    });

    it('throws conflict when guarded status update is stale', async () => {
      tx.salesOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        persistSalesOrderUpdate(tx as never, {
          id: 'so-1',
          tenantId: 'tenant-1',
          currentStatus: SalesOrderStatus.DRAFT,
          nextStatus: SalesOrderStatus.CONFIRMED,
          fieldData: {},
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws not found when field-only update misses the order', async () => {
      tx.salesOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        persistSalesOrderUpdate(tx as never, {
          id: 'so-1',
          tenantId: 'tenant-1',
          currentStatus: SalesOrderStatus.DRAFT,
          fieldData: { notes: 'Missing' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
