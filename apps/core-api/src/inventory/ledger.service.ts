import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, LocationType, Prisma } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { TenantContextService } from '../common/services/tenant-context.service';

import Decimal = Prisma.Decimal;

export const STOCK_ENABLED_LOCATION_TYPES: ReadonlySet<LocationType> = new Set([
  LocationType.bin,
  LocationType.staging_tote,
]);

export interface RecordTransactionParams {
  itemId: string;
  locationId: string;
  quantity: number | Decimal;
  type: TransactionType;
  referenceId?: string;
  costBasis?: number | Decimal | null;
  partsReservationId?: string | null;
}

interface AggregatedStockDelta {
  itemId: string;
  locationId: string;
  quantity: Decimal;
}

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

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
    await this.recordTransactions([params], prismaVal);
  }

  /**
   * Records multiple inventory transactions and updates the cached stock quantity concurrently.
   * Uses Prisma Interactive Transaction to ensure atomicity.
   * Eliminates N+1 queries.
   * @returns void (does not return persisted records to avoid excessive queries)
   */
  async recordTransactions(
    paramsArray: RecordTransactionParams[],
    prismaVal?: Prisma.TransactionClient,
  ): Promise<void> {
    if (paramsArray.length === 0) return;

    const tx = prismaVal || this.prisma;
    const tenantId = await this.tenantContext.getTenantId();

    const locationIds = [...new Set(paramsArray.map((p) => p.locationId))];
    await this.validateLocations(tx, tenantId, locationIds);

    await this.persistTransactions(tx, tenantId, paramsArray);

    const aggregatedDeltas = this.aggregateStockDeltas(paramsArray);
    await this.applyStockUpdates(tx, tenantId, aggregatedDeltas);
  }

  /**
   * Validates that all destination locations exist and are eligible to hold stock.
   */
  private async validateLocations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    locationIds: string[],
  ): Promise<void> {
    const locations = await tx.storageLocation.findMany({
      where: { tenant_id: tenantId, id: { in: locationIds } },
    });
    const locationsMap = new Map(locations.map((loc) => [loc.id, loc]));

    for (const locationId of locationIds) {
      const location = locationsMap.get(locationId);
      if (!location) {
        throw new BadRequestException(`Location ${locationId} not found`);
      }
      if (!STOCK_ENABLED_LOCATION_TYPES.has(location.type)) {
        throw new BadRequestException(
          `Stock can only be stored in BIN or STAGING_TOTE locations. Current type: ${location.type} (${location.name})`,
        );
      }
    }
  }

  /**
   * Persists inventory transactions in bulk.
   */
  private async persistTransactions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paramsArray: RecordTransactionParams[],
  ): Promise<void> {
    const transactionsData = paramsArray.map((params) => ({
      tenant_id: tenantId,
      item_id: params.itemId,
      location_id: params.locationId,
      quantity: new Decimal(params.quantity.toString()),
      type: params.type,
      reference_id: params.referenceId,
      ...(params.partsReservationId !== undefined && {
        parts_reservation_id: params.partsReservationId,
      }),
      cost_basis:
        params.costBasis !== undefined && params.costBasis !== null
          ? new Decimal(params.costBasis.toString())
          : null,
    }));

    await tx.inventoryTransaction.createMany({
      data: transactionsData,
    });
  }

  /**
   * Aggregates quantities by stock key to prevent multiple concurrent mutations
   * for the same item/location in a single transaction.
   */
  private aggregateStockDeltas(
    paramsArray: RecordTransactionParams[],
  ): AggregatedStockDelta[] {
    const aggregatedStocks = new Map<string, AggregatedStockDelta>();

    for (const params of paramsArray) {
      const stockKey = `${params.itemId}-${params.locationId}`;
      const existing = aggregatedStocks.get(stockKey);
      const paramQty = new Decimal(params.quantity);

      if (existing) {
        existing.quantity = existing.quantity.add(paramQty);
      } else {
        aggregatedStocks.set(stockKey, {
          itemId: params.itemId,
          locationId: params.locationId,
          quantity: paramQty,
        });
      }
    }

    return Array.from(aggregatedStocks.values());
  }

  /**
   * Updates cached stock balances concurrently and guards against negative inventory on hand.
   */
  private async applyStockUpdates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    deltas: AggregatedStockDelta[],
  ): Promise<void> {
    const existingStocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        OR: deltas.map((d) => ({
          catalog_item_id: d.itemId,
          location_id: d.locationId,
        })),
      },
    });

    const existingStocksMap = new Map(
      existingStocks.map((stock) => [
        `${stock.catalog_item_id}-${stock.location_id}`,
        stock,
      ]),
    );

    type InventoryStockRecord = (typeof existingStocks)[number];

    await chunkedPromiseAll(deltas, async (delta) => {
      const stockKey = `${delta.itemId}-${delta.locationId}`;
      const existingStock = existingStocksMap.get(stockKey);

      let stock: InventoryStockRecord;
      if (existingStock) {
        const updateResult = await tx.inventoryStock.updateMany({
          where: { id: existingStock.id, tenant_id: tenantId },
          data: {
            quantity_on_hand: {
              increment: delta.quantity,
            },
          },
        });

        if (updateResult.count === 0) {
          throw new BadRequestException(
            `Inventory stock ${existingStock.id} not found for current tenant`,
          );
        }

        const refreshedStock = await tx.inventoryStock.findFirst({
          where: { id: existingStock.id, tenant_id: tenantId },
        });

        if (!refreshedStock) {
          throw new BadRequestException(
            `Inventory stock ${existingStock.id} not found after update`,
          );
        }

        stock = refreshedStock;
      } else {
        stock = await tx.inventoryStock.create({
          data: {
            tenant_id: tenantId,
            catalog_item_id: delta.itemId,
            location_id: delta.locationId,
            quantity_on_hand: delta.quantity,
            quantity_reserved: new Decimal(0),
          },
        });
        existingStocksMap.set(stockKey, stock);
      }

      if (new Decimal(stock.quantity_on_hand).lt(0)) {
        throw new BadRequestException(
          `Insufficient Stock: Transaction would result in negative stock (${stock.quantity_on_hand.toString()}) for item ${delta.itemId} at location ${delta.locationId}`,
        );
      }
    });
  }

  /**
   * Gets all transactions for a specific item and location.
   * Useful for audit trail and debugging.
   */
  async getTransactionHistory(itemId: string, locationId?: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return await this.prisma.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
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
    const tenantId = await this.tenantContext.getTenantId();
    const [transactions, stock] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where: {
          tenant_id: tenantId,
          item_id: itemId,
          location_id: locationId,
        },
      }),
      this.prisma.inventoryStock.findFirst({
        where: {
          tenant_id: tenantId,
          catalog_item_id: itemId,
          location_id: locationId,
        },
      }),
    ]);

    const sumFromTransactions = transactions.reduce(
      (sum, tx) => sum.add(new Decimal(tx.quantity)),
      new Decimal(0),
    );

    const onHand = stock ? new Decimal(stock.quantity_on_hand) : new Decimal(0);
    return sumFromTransactions.equals(onHand);
  }
}
