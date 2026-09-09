import { BadRequestException } from '@nestjs/common';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import {
  aggregateAndValidateReceiptItems,
  determinePostReceiptStatus,
} from './purchase-receipt.helpers';

import Decimal = Prisma.Decimal;

describe('purchase-receipt.helpers', () => {
  describe('aggregateAndValidateReceiptItems', () => {
    const poItems = [
      {
        id: 'poi-1',
        catalog_item_id: 'cat-1',
        quantity: new Decimal(10),
        quantity_received: new Decimal(2),
        unit_cost: new Decimal(25),
      },
      {
        id: 'poi-2',
        catalog_item_id: 'cat-2',
        quantity: new Decimal(5),
        quantity_received: new Decimal(0),
        unit_cost: new Decimal(100),
      },
    ] as any[];

    const currentItemsMap = new Map<string, any>([
      [
        'poi-1',
        {
          id: 'poi-1',
          catalog_item_id: 'cat-1',
          quantity: new Decimal(10),
          quantity_received: new Decimal(2),
          unit_cost: new Decimal(25),
        },
      ],
      [
        'poi-2',
        {
          id: 'poi-2',
          catalog_item_id: 'cat-2',
          quantity: new Decimal(5),
          quantity_received: new Decimal(0),
          unit_cost: new Decimal(100),
        },
      ],
    ]);

    it('aggregates multiple entries for the same item and returns validated items', () => {
      const receivedItems = [
        { itemId: 'cat-1', quantity: 3 },
        { itemId: 'cat-1', quantity: 2 },
        { itemId: 'cat-2', quantity: 1 },
      ];

      const result = aggregateAndValidateReceiptItems(
        receivedItems,
        poItems,
        currentItemsMap,
      );

      expect(result).toHaveLength(2);

      const poi1Result = result.find((r) => r.poItem.id === 'poi-1');
      expect(poi1Result).toBeDefined();
      expect(poi1Result?.quantity.toNumber()).toBe(5);
      expect(poi1Result?.quantityReceived.toNumber()).toBe(2);

      const poi2Result = result.find((r) => r.poItem.id === 'poi-2');
      expect(poi2Result).toBeDefined();
      expect(poi2Result?.quantity.toNumber()).toBe(1);
      expect(poi2Result?.quantityReceived.toNumber()).toBe(0);
    });

    it('throws BadRequestException if itemId is missing', () => {
      const receivedItems = [{ itemId: '', quantity: 2 }];

      expect(() =>
        aggregateAndValidateReceiptItems(
          receivedItems,
          poItems,
          currentItemsMap,
        ),
      ).toThrow(new BadRequestException('itemId is required for each received item'));
    });

    it('throws BadRequestException if item is not part of the PO', () => {
      const receivedItems = [{ itemId: 'unknown-cat', quantity: 2 }];

      expect(() =>
        aggregateAndValidateReceiptItems(
          receivedItems,
          poItems,
          currentItemsMap,
        ),
      ).toThrow(
        new BadRequestException(
          'Item unknown-cat not in this PO. Available: cat-1, cat-2',
        ),
      );
    });

    it('throws BadRequestException if current item is not found in currentItemsMap', () => {
      const receivedItems = [{ itemId: 'cat-1', quantity: 2 }];
      const incompleteMap = new Map();

      expect(() =>
        aggregateAndValidateReceiptItems(
          receivedItems,
          poItems,
          incompleteMap,
        ),
      ).toThrow(new BadRequestException('Item cat-1 not found in DB'));
    });

    it('throws BadRequestException if receiving more than ordered', () => {
      // poi-1 has ordered: 10, already received: 2. Remaining: 8. Receiving 9 should fail.
      const receivedItems = [{ itemId: 'cat-1', quantity: 9 }];

      expect(() =>
        aggregateAndValidateReceiptItems(
          receivedItems,
          poItems,
          currentItemsMap,
        ),
      ).toThrow(
        new BadRequestException('Cannot receive more than ordered for item cat-1'),
      );
    });
  });

  describe('determinePostReceiptStatus', () => {
    it('returns COMPLETED when all items have quantity_received >= quantity', () => {
      const items = [
        { quantity: new Decimal(10), quantity_received: new Decimal(10) },
        { quantity: new Decimal(5), quantity_received: new Decimal(5) },
      ];

      expect(
        determinePostReceiptStatus(items, PurchaseOrderStatus.PARTIAL),
      ).toBe(PurchaseOrderStatus.COMPLETED);
    });

    it('returns PARTIAL when some items are received but not all', () => {
      const items = [
        { quantity: new Decimal(10), quantity_received: new Decimal(4) },
        { quantity: new Decimal(5), quantity_received: new Decimal(0) },
      ];

      expect(
        determinePostReceiptStatus(items, PurchaseOrderStatus.SENT),
      ).toBe(PurchaseOrderStatus.PARTIAL);
    });

    it('preserves previous status when no items have been received', () => {
      const items = [
        { quantity: new Decimal(10), quantity_received: new Decimal(0) },
        { quantity: new Decimal(5), quantity_received: new Decimal(0) },
      ];

      expect(
        determinePostReceiptStatus(items, PurchaseOrderStatus.SENT),
      ).toBe(PurchaseOrderStatus.SENT);
      expect(
        determinePostReceiptStatus(items, PurchaseOrderStatus.DRAFT),
      ).toBe(PurchaseOrderStatus.DRAFT);
    });
  });
});
