import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  TransactionType,
  type InventoryStock,
  type InvoiceItem,
} from '@prisma/client';
import { chunkedPromiseAll } from '../../common/utils/promise.util';

import Decimal = Prisma.Decimal;

type StockUpdate = {
  catalog_item_id: string;
  locationId: string;
  quantityToDeduct: Decimal;
};

export async function processSaleInventoryDeduction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceItems: InvoiceItem[],
  invoiceNumber: string,
): Promise<void> {
  const uniqueCatalogItemIds = [
    ...new Set(
      invoiceItems
        .map((item) => item.catalog_item_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  const stockMap = new Map<string, InventoryStock[]>();
  if (uniqueCatalogItemIds.length > 0) {
    const stocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        catalog_item_id: { in: uniqueCatalogItemIds },
      },
      orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
    });
    stocks.forEach((stock) => {
      const list = stockMap.get(stock.catalog_item_id) || [];
      list.push(stock);
      stockMap.set(stock.catalog_item_id, list);
    });
  }

  const stockUpdatesMap = new Map<string, StockUpdate>();
  const transactionCreations: Prisma.InventoryTransactionCreateManyInput[] = [];

  for (const item of invoiceItems) {
    if (!item.catalog_item_id) continue;

    const quantityToDeduct = new Decimal(item.quantity);
    if (!quantityToDeduct.isFinite() || quantityToDeduct.lte(0)) {
      throw new BadRequestException(
        `Invalid inventory quantity for item ${item.description}. Stock-tracked items require a positive quantity.`,
      );
    }

    const stocks = stockMap.get(item.catalog_item_id) || [];
    const stock =
      stocks.find((entry) =>
        new Decimal(entry.quantity_on_hand).gte(quantityToDeduct),
      ) || stocks[0];

    if (!stock) {
      throw new BadRequestException(
        `No stock record found for item ${item.description}`,
      );
    }

    if (new Decimal(stock.quantity_on_hand).lt(quantityToDeduct)) {
      throw new BadRequestException(
        `Insufficient stock for item ${item.description} at location ${stock.location_id} (Req: ${quantityToDeduct.toString()}, Available: ${stock.quantity_on_hand.toString()})`,
      );
    }

    const locationId = stock.location_id;
    const compositeKey = `${item.catalog_item_id}_${locationId}`;
    const existingUpdate = stockUpdatesMap.get(compositeKey) || {
      catalog_item_id: item.catalog_item_id,
      locationId,
      quantityToDeduct: new Decimal(0),
    };

    existingUpdate.quantityToDeduct =
      existingUpdate.quantityToDeduct.add(quantityToDeduct);
    stockUpdatesMap.set(compositeKey, existingUpdate);
    stock.quantity_on_hand = new Decimal(stock.quantity_on_hand).sub(
      quantityToDeduct,
    );

    transactionCreations.push({
      tenant_id: tenantId,
      item_id: item.catalog_item_id,
      location_id: locationId,
      quantity: new Prisma.Decimal(item.quantity).negated(),
      type: TransactionType.SALE_ISSUE,
      reference_id: invoiceNumber,
    });
  }

  const stockUpdates = Array.from(stockUpdatesMap.values());
  await chunkedPromiseAll(stockUpdates, async (update) => {
    const updateResult = await tx.inventoryStock.updateMany({
      where: {
        catalog_item_id: update.catalog_item_id,
        location_id: update.locationId,
        quantity_on_hand: { gte: update.quantityToDeduct },
      },
      data: {
        quantity_on_hand: { decrement: update.quantityToDeduct },
      },
    });

    if (updateResult.count === 0) {
      const latestStock = await tx.inventoryStock.findFirst({
        where: {
          tenant_id: tenantId,
          catalog_item_id: update.catalog_item_id,
          location_id: update.locationId,
        },
      });
      throw new BadRequestException(
        `Insufficient stock for item at location ${update.locationId} (Req: ${update.quantityToDeduct.toString()}, Available: ${latestStock?.quantity_on_hand.toString() ?? '0'})`,
      );
    }
  });

  if (transactionCreations.length > 0) {
    await tx.inventoryTransaction.createMany({
      data: transactionCreations,
    });
  }
}
