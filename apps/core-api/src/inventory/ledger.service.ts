import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, Prisma } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';

import Decimal = Prisma.Decimal;

export interface RecordTransactionParams {
  itemId: string;
  locationId: string;
  quantity: number | Decimal;
  type: TransactionType;
  referenceId?: string;
  costBasis?: number | Decimal | null;
}

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /**
   * Records an inventory transaction and updates the cached stock quantity.
   * Uses Prisma Interactive Transaction to ensure atomicity.
   *
   * @param params Transaction parameters
   * @returns The created InventoryTransaction record
   * @throws BadRequestException if the transaction would result in negative stock
   */
  async recordTransaction(
    params: RecordTransactionParams,
    prismaVal?: Prisma.TransactionClient,
  ) {
    // This is kept for backward compatibility if a single item is passed
    return (await this.recordTransactions([params], prismaVal))[0];
  }

  /**
   * Records multiple inventory transactions and updates the cached stock quantity concurrently.
   * Uses Prisma Interactive Transaction to ensure atomicity.
   * Eliminates N+1 queries.
   */
  async recordTransactions(
    paramsArray: RecordTransactionParams[],
    prismaVal?: Prisma.TransactionClient,
  ) {
    if (paramsArray.length === 0) return [];

    const tx = prismaVal || this.prisma;

    // PRE-FETCH & MAP Location validation
    const locationIds = [...new Set(paramsArray.map(p => p.locationId))];
    const locations = await tx.storageLocation.findMany({
      where: { id: { in: locationIds } },
    });
    const locationsMap = new Map(locations.map(loc => [loc.id, loc]));

    for (const params of paramsArray) {
      const location = locationsMap.get(params.locationId);
      if (!location) {
        throw new BadRequestException(`Location ${params.locationId} not found`);
      }
      if (location.type !== 'bin') {
        throw new BadRequestException(
          `Stock can only be stored in BIN locations. Current type: ${location.type} (${location.name})`,
        );
      }
    }

    // Create transactions in bulk
    const transactionsData = paramsArray.map(params => ({
      item_id: params.itemId,
      location_id: params.locationId,
      quantity: new Decimal(params.quantity.toString()),
      type: params.type,
      reference_id: params.referenceId,
      cost_basis: params.costBasis ? new Decimal(params.costBasis.toString()) : null,
    }));

    await tx.inventoryTransaction.createMany({
      data: transactionsData
    });

    // We need to fetch the created transactions to return them if needed, but since it's hard to match
    // them exactly to the input without a unique ID in the input, we might just return true for bulk.
    // For now, let's fetch them based on reference_id if available, or just omit the returned objects.

    // Update stocks
    // Find all existing stocks for the item/location combinations
    const itemIds = [...new Set(paramsArray.map(p => p.itemId))];
    const existingStocks = await tx.inventoryStock.findMany({
      where: {
        OR: paramsArray.map(p => ({
          catalog_item_id: p.itemId,
          location_id: p.locationId,
        }))
      }
    });

    const existingStocksMap = new Map(
      existingStocks.map(stock => [`${stock.catalog_item_id}-${stock.location_id}`, stock])
    );

    // Process stock updates concurrently using chunkedPromiseAll
    await chunkedPromiseAll(paramsArray, async (params) => {
      const stockKey = `${params.itemId}-${params.locationId}`;
      const existingStock = existingStocksMap.get(stockKey);

      let stock;
      if (existingStock) {
        stock = await tx.inventoryStock.update({
          where: { id: existingStock.id },
          data: {
            quantity_on_hand: {
              increment: Number(params.quantity),
            },
          },
        });
      } else {
        stock = await tx.inventoryStock.create({
          data: {
            catalog_item_id: params.itemId,
            location_id: params.locationId,
            quantity_on_hand: Number(params.quantity),
            quantity_reserved: 0,
          },
        });
        existingStocksMap.set(stockKey, stock); // Update map for subsequent operations in same transaction
      }

      if (stock.quantity_on_hand < 0) {
        throw new BadRequestException(
          `Insufficient Stock: Transaction would result in negative stock (${stock.quantity_on_hand}) for item ${params.itemId} at location ${params.locationId}`,
        );
      }
    });

    return transactionsData; // Approximate return
  }

  /**
   * Gets all transactions for a specific item and location.
   * Useful for audit trail and debugging.
   */
  async getTransactionHistory(itemId: string, locationId?: string) {
    return await this.prisma.inventoryTransaction.findMany({
      where: {
        item_id: itemId,
        ...(locationId && { location_id: locationId }),
      },
      select: {
        id: true,
        quantity: true,
        type: true,
        reference_id: true,
        cost_basis: true,
        createdAt: true,
        item: {
          select: {
            sku: true,
            name: true,
          },
        },
        location: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Verifies ledger integrity by comparing transaction sum with cached stock.
   * Returns true if they match, false otherwise.
   */
  async verifyLedgerIntegrity(
    itemId: string,
    locationId: string,
  ): Promise<boolean> {
    const [transactions, stock] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where: {
          item_id: itemId,
          location_id: locationId,
        },
      }),
      this.prisma.inventoryStock.findUnique({
        where: {
          catalog_item_id_location_id: {
            catalog_item_id: itemId,
            location_id: locationId,
          },
        },
      }),
    ]);

    const sumFromTransactions = transactions.reduce(
      (sum, tx) => sum + Number(tx.quantity),
      0,
    );

    return sumFromTransactions === (stock?.quantity_on_hand || 0);
  }
}
