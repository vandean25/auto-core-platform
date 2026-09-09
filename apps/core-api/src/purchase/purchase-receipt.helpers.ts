import { BadRequestException } from '@nestjs/common';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';

import Decimal = Prisma.Decimal;

export interface IncomingReceiptItem {
  itemId: string;
  quantity: number;
}

export interface PoItemSummary {
  id: string;
  catalog_item_id: string;
  quantity: number | Decimal;
  quantity_received: number | Decimal;
  unit_cost: number | Decimal;
}

export interface ValidatedAggregatedReceiptItem {
  quantity: Decimal;
  received: IncomingReceiptItem;
  poItem: PoItemSummary;
  quantityReceived: Decimal;
}

/**
 * Aggregates incoming received items by purchase order item and validates:
 * - itemId exists
 * - itemId belongs to the purchase order
 * - Item exists in current database snapshot
 * - Aggregated received quantity does not exceed ordered quantity
 */
export function aggregateAndValidateReceiptItems(
  receivedItems: IncomingReceiptItem[],
  poItems: PoItemSummary[],
  currentItemsMap: Map<string, PoItemSummary>,
): ValidatedAggregatedReceiptItem[] {
  const aggregatedReceived = new Map<string, ValidatedAggregatedReceiptItem>();
  const poItemsMap = new Map(poItems.map((i) => [i.catalog_item_id, i]));

  for (const received of receivedItems) {
    if (!received.itemId) {
      throw new BadRequestException('itemId is required for each received item');
    }

    const poItem = poItemsMap.get(received.itemId);
    if (!poItem) {
      const availableIds = poItems.map((i) => i.catalog_item_id).join(', ');
      throw new BadRequestException(
        `Item ${received.itemId} not in this PO. Available: ${availableIds}`,
      );
    }

    const existing = aggregatedReceived.get(poItem.id);
    if (existing) {
      existing.quantity = existing.quantity.add(new Decimal(received.quantity));
    } else {
      const currentItem = currentItemsMap.get(poItem.id);
      aggregatedReceived.set(poItem.id, {
        quantity: new Decimal(received.quantity),
        received,
        poItem,
        quantityReceived: new Decimal(currentItem?.quantity_received ?? 0),
      });
    }
  }

  const validatedAggregatedItems = Array.from(aggregatedReceived.values());

  for (const { poItem, quantity, received } of validatedAggregatedItems) {
    const currentItem = currentItemsMap.get(poItem.id);
    if (!currentItem) {
      throw new BadRequestException(`Item ${received.itemId} not found in DB`);
    }

    if (
      new Decimal(currentItem.quantity_received)
        .add(quantity)
        .gt(new Decimal(currentItem.quantity))
    ) {
      throw new BadRequestException(
        `Cannot receive more than ordered for item ${received.itemId}`,
      );
    }
  }

  return validatedAggregatedItems;
}

/**
 * Determines new purchase order status after receiving items.
 */
export function determinePostReceiptStatus(
  items: Array<{
    quantity: number | Decimal;
    quantity_received: number | Decimal;
  }>,
  currentStatus: PurchaseOrderStatus,
): PurchaseOrderStatus {
  if (items.length === 0) {
    return currentStatus;
  }

  const allReceived = items.every((i) =>
    new Decimal(i.quantity_received).gte(new Decimal(i.quantity)),
  );
  const anyReceived = items.some((i) =>
    new Decimal(i.quantity_received).gt(0),
  );

  if (allReceived) {
    return PurchaseOrderStatus.COMPLETED;
  }
  if (anyReceived) {
    return PurchaseOrderStatus.PARTIAL;
  }

  return currentStatus;
}
