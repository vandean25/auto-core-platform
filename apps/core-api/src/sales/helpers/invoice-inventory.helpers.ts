import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  TransactionType,
  LocationType,
  type InvoiceItem,
} from '@prisma/client';
import type { AtpService } from '../../inventory/atp.service';

import Decimal = Prisma.Decimal;

type StockUpdate = {
  catalog_item_id: string;
  stockId: string;
  locationId: string;
  quantityToDeduct: Decimal;
};

type SaleStockCandidate = {
  id: string;
  catalog_item_id: string;
  location_id: string;
  quantityAvailable: Decimal;
};

export interface SaleInventoryDeductionParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  invoiceItems: InvoiceItem[];
  invoiceNumber: string;
  atpService: AtpService;
}

export async function processSaleInventoryDeduction({
  tx,
  tenantId,
  siteId,
  invoiceItems,
  invoiceNumber,
  atpService,
}: SaleInventoryDeductionParams): Promise<void> {
  const uniqueCatalogItemIds = [
    ...new Set(
      invoiceItems
        .map((item) => item.catalog_item_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  const stockMap = new Map<string, SaleStockCandidate[]>();
  if (uniqueCatalogItemIds.length > 0) {
    const stocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        catalog_item_id: { in: uniqueCatalogItemIds },
        location: {
          tenant_id: tenantId,
          site_id: siteId,
          type: { not: LocationType.staging_tote },
        },
      },
      orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
    });
    stocks.forEach((stock) => {
      const list = stockMap.get(stock.catalog_item_id) || [];
      const totals = atpService.calculateAtp(stock, {
        operation: 'sales_allocation',
        stockId: stock.id,
        locationId: stock.location_id,
        tenantId,
        siteId,
      });
      list.push({
        id: stock.id,
        catalog_item_id: stock.catalog_item_id,
        location_id: stock.location_id,
        quantityAvailable: totals.quantityAvailable,
      });
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
    let remainingQuantity = quantityToDeduct;

    for (const stock of stocks) {
      if (remainingQuantity.isZero()) break;
      if (!stock.quantityAvailable.gt(0)) continue;

      const quantityFromStock = remainingQuantity.lt(stock.quantityAvailable)
        ? remainingQuantity
        : stock.quantityAvailable;
      const compositeKey = `${item.catalog_item_id}_${stock.location_id}`;
      const existingUpdate = stockUpdatesMap.get(compositeKey) || {
        catalog_item_id: item.catalog_item_id,
        stockId: stock.id,
        locationId: stock.location_id,
        quantityToDeduct: new Decimal(0),
      };

      existingUpdate.quantityToDeduct =
        existingUpdate.quantityToDeduct.add(quantityFromStock);
      stockUpdatesMap.set(compositeKey, existingUpdate);
      stock.quantityAvailable = stock.quantityAvailable.sub(quantityFromStock);
      remainingQuantity = remainingQuantity.sub(quantityFromStock);

      transactionCreations.push({
        tenant_id: tenantId,
        item_id: item.catalog_item_id,
        location_id: stock.location_id,
        quantity: quantityFromStock.negated(),
        type: TransactionType.SALE_ISSUE,
        reference_id: invoiceNumber,
      });
    }

    if (remainingQuantity.gt(0)) {
      const availableQuantity = quantityToDeduct.sub(remainingQuantity);
      throw new ConflictException(
        `Insufficient ATP for item ${item.description} (Req: ${quantityToDeduct.toString()}, Available: ${availableQuantity.toString()})`,
      );
    }
  }

  const stockUpdates = Array.from(stockUpdatesMap.values()).sort(
    (left, right) =>
      left.catalog_item_id.localeCompare(right.catalog_item_id) ||
      left.locationId.localeCompare(right.locationId),
  );
  await lockSaleStockRows(tx, tenantId, stockUpdates);

  for (const update of stockUpdates) {
    await atpService.deductOnHandForSale(
      {
        stockId: update.stockId,
        quantity: update.quantityToDeduct,
        tenantId,
        siteId,
      },
      tx,
    );
  }

  if (transactionCreations.length > 0) {
    await tx.inventoryTransaction.createMany({
      data: transactionCreations,
    });
  }
}

async function lockSaleStockRows(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stockUpdates: readonly StockUpdate[],
): Promise<void> {
  const stockIds = [
    ...new Set(stockUpdates.map((update) => update.stockId)),
  ].sort((left, right) => left.localeCompare(right));
  if (stockIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked canonical stock lock order prevents cross-invoice deadlocks.
  await tx.$queryRaw`
    SELECT id
    FROM inventory_stocks
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(stockIds)})
    ORDER BY id
    FOR UPDATE
  `;
}
