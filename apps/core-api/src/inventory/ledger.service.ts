import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TransactionType,
  LocationType,
  Prisma,
  StockAdjustmentReason,
  StockAdjustmentValueSource,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import { computeExtendedValue } from './inventory-valuation.math.js';

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
  reason?: StockAdjustmentReason | null;
  note?: string | null;
  valueSource?: StockAdjustmentValueSource | null;
  overrideReason?: string | null;
  createdByUserId?: string | null;
  reversalOfTransactionId?: string | null;
  /** Not persisted: the booking moves quantity only and skips the moving-average step. */
  valuationNeutral?: boolean;
  partsReservationId?: string | null;
  movementGroupId?: string | null;
  stockTransferId?: string | null;
}

export interface RecordTransactionsOptions {
  /**
   * Overrides the stock-eligible location types. Same-GmbH transfers write
   * ledger rows against the system in_transit locations (ruling 34).
   */
  allowedLocationTypes?: ReadonlySet<LocationType>;
  /**
   * Overrides the sites whose locations the caller may write to. Only same-GmbH
   * transfer settlement uses it, with the transfer's own two endpoint sites
   * after the transfer access check: a to-site-only receiver settles against
   * the from-site in-transit location. Never pass ids taken from a request body.
   */
  authorizedSiteIds?: readonly string[];
}

interface AggregatedStockDelta {
  itemId: string;
  locationId: string;
  quantity: Decimal;
}

type LocationSiteIds = ReadonlyMap<string, string>;

function stockKey(delta: AggregatedStockDelta): string {
  return `${delta.itemId}-${delta.locationId}`;
}

function stocksByKey<
  T extends { catalog_item_id: string; location_id: string },
>(stocks: T[]): Map<string, T> {
  return new Map(
    stocks.map((stock) => [
      `${stock.catalog_item_id}-${stock.location_id}`,
      stock,
    ]),
  );
}

function assertStocksSettled(
  deltas: AggregatedStockDelta[],
  existing: ReadonlyMap<string, { id: string }>,
  refreshed: ReadonlyMap<string, { quantity_on_hand: Decimal }>,
): void {
  for (const delta of deltas) {
    const key = stockKey(delta);
    const stock = refreshed.get(key);
    if (!stock) {
      throw new BadRequestException(
        `Inventory stock ${existing.get(key)?.id ?? key} not found after update`,
      );
    }
    if (new Decimal(stock.quantity_on_hand).lt(0)) {
      throw new BadRequestException(
        `Insufficient Stock: Transaction would result in negative stock (${stock.quantity_on_hand.toString()}) for item ${delta.itemId} at location ${delta.locationId}`,
      );
    }
  }
}

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(InventoryValuationService)
    private readonly valuationService: InventoryValuationService,
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
    options?: RecordTransactionsOptions,
  ): Promise<void> {
    if (paramsArray.length === 0) return;

    const tx = prismaVal || this.prisma;
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds =
      options?.authorizedSiteIds ??
      (await this.siteContext.listAuthorizedSiteIds());

    const locationIds = [...new Set(paramsArray.map((p) => p.locationId))];
    const locationSiteIds = await this.validateLocations(
      tx,
      tenantId,
      locationIds,
      authorizedSiteIds,
      options?.allowedLocationTypes,
    );

    const preparedValuation = await this.valuationService.prepareAndLockBatch(
      tx,
      tenantId,
      paramsArray.map((params) => ({
        itemId: params.itemId,
        siteId: this.getLocationSiteId(locationSiteIds, params.locationId),
        quantity: params.quantity,
        type: params.type,
        costBasis: params.costBasis,
        isReversal: Boolean(params.reversalOfTransactionId),
        valuationNeutral: params.valuationNeutral,
      })),
    );

    const maxSeqByIndex = await this.persistTransactions(
      tx,
      tenantId,
      paramsArray,
      locationSiteIds,
      preparedValuation.stampedCostBasisByIndex,
    );
    await preparedValuation.commit(maxSeqByIndex);

    const aggregatedDeltas = this.aggregateStockDeltas(paramsArray);
    await this.applyStockUpdates(
      tx,
      tenantId,
      aggregatedDeltas,
      locationSiteIds,
    );
  }

  /**
   * Validates that all destination locations exist and are eligible to hold stock.
   */
  private async validateLocations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    locationIds: string[],
    authorizedSiteIds: readonly string[],
    allowedTypes?: ReadonlySet<LocationType>,
  ): Promise<LocationSiteIds> {
    const enabledTypes = allowedTypes ?? STOCK_ENABLED_LOCATION_TYPES;
    const locations = await tx.storageLocation.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: locationIds },
        site_id: { in: [...authorizedSiteIds] },
      },
    });
    const locationsMap = new Map(locations.map((loc) => [loc.id, loc]));

    for (const locationId of locationIds) {
      const location = locationsMap.get(locationId);
      if (!location) {
        throw new BadRequestException(`Location ${locationId} not found`);
      }
      if (!enabledTypes.has(location.type)) {
        throw new BadRequestException(
          `Stock can only be stored in ${[...enabledTypes]
            .map((type) => type.toUpperCase())
            .join(' or ')} locations. Current type: ${location.type} (${
            location.name
          })`,
        );
      }
    }

    return new Map(
      locations.map((location) => [location.id, location.site_id]),
    );
  }

  /**
   * Persists inventory transactions in bulk.
   */
  private async persistTransactions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paramsArray: RecordTransactionParams[],
    locationSiteIds: LocationSiteIds,
    stampedCostBasisByIndex: readonly (Decimal | null)[],
  ): Promise<Map<number, bigint>> {
    const transactionsData = paramsArray.map((params, index) => {
      const costBasis = stampedCostBasisByIndex[index] ?? null;
      return {
        tenant_id: tenantId,
        site_id: this.getLocationSiteId(locationSiteIds, params.locationId),
        item_id: params.itemId,
        location_id: params.locationId,
        quantity: new Decimal(params.quantity.toString()),
        type: params.type,
        reference_id: params.referenceId,
        ...(params.partsReservationId !== undefined && {
          parts_reservation_id: params.partsReservationId,
        }),
        ...(params.movementGroupId !== undefined && {
          movement_group_id: params.movementGroupId,
        }),
        ...(params.stockTransferId !== undefined && {
          stock_transfer_id: params.stockTransferId,
        }),
        ...(params.reason !== undefined && {
          reason: params.reason,
        }),
        ...(params.note !== undefined && {
          note: params.note,
        }),
        ...(params.valueSource !== undefined && {
          value_source: params.valueSource,
        }),
        ...(params.overrideReason !== undefined && {
          override_reason: params.overrideReason,
        }),
        ...(params.createdByUserId !== undefined && {
          created_by_user_id: params.createdByUserId,
        }),
        ...(params.reversalOfTransactionId !== undefined && {
          reversal_of_transaction_id: params.reversalOfTransactionId,
        }),
        cost_basis: costBasis,
      };
    });

    const created = await tx.inventoryTransaction.createManyAndReturn({
      data: transactionsData,
      select: { seq: true },
    });
    const maxSeqByIndex = new Map<number, bigint>();
    created.forEach((row, index) => {
      maxSeqByIndex.set(index, row.seq);
    });
    return maxSeqByIndex;
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
   * Updates cached stock balances and guards against negative inventory on hand.
   * New stocks go in one createMany; existing stocks that change by the same quantity share one update.
   */
  private async applyStockUpdates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    deltas: AggregatedStockDelta[],
    locationSiteIds: LocationSiteIds,
  ): Promise<void> {
    const where = {
      tenant_id: tenantId,
      OR: deltas.map((delta) => ({
        catalog_item_id: delta.itemId,
        location_id: delta.locationId,
        site_id: this.getLocationSiteId(locationSiteIds, delta.locationId),
      })),
    };
    const existing = stocksByKey(await tx.inventoryStock.findMany({ where }));

    const missing = deltas.filter((delta) => !existing.has(stockKey(delta)));
    if (missing.length > 0) {
      await tx.inventoryStock.createMany({
        data: missing.map((delta) => ({
          tenant_id: tenantId,
          site_id: this.getLocationSiteId(locationSiteIds, delta.locationId),
          catalog_item_id: delta.itemId,
          location_id: delta.locationId,
          quantity_on_hand: delta.quantity,
          quantity_reserved: new Decimal(0),
        })),
      });
    }
    await this.incrementExistingStocks(tx, tenantId, deltas, existing);

    const refreshed = stocksByKey(await tx.inventoryStock.findMany({ where }));
    assertStocksSettled(deltas, existing, refreshed);
  }

  private async incrementExistingStocks(
    tx: Prisma.TransactionClient,
    tenantId: string,
    deltas: AggregatedStockDelta[],
    existing: ReadonlyMap<string, { id: string }>,
  ): Promise<void> {
    const stockIdsByQuantity = new Map<string, string[]>();
    for (const delta of deltas) {
      const stock = existing.get(stockKey(delta));
      if (stock) {
        const quantity = delta.quantity.toString();
        stockIdsByQuantity.set(quantity, [
          ...(stockIdsByQuantity.get(quantity) ?? []),
          stock.id,
        ]);
      }
    }
    for (const [quantity, stockIds] of stockIdsByQuantity) {
      const result = await tx.inventoryStock.updateMany({
        where: { id: { in: stockIds }, tenant_id: tenantId },
        data: { quantity_on_hand: { increment: new Decimal(quantity) } },
      });
      if (result.count !== stockIds.length) {
        throw new BadRequestException(
          `Inventory stock ${stockIds[0]} not found for current tenant`,
        );
      }
    }
  }

  private getLocationSiteId(
    locationSiteIds: LocationSiteIds,
    locationId: string,
  ): string {
    const siteId = locationSiteIds.get(locationId);
    if (!siteId) {
      throw new BadRequestException(`Location ${locationId} is missing a site`);
    }
    return siteId;
  }

  /**
   * Gets all transactions for a specific item and location.
   * Useful for audit trail and debugging.
   */
  async getTransactionHistory(itemId: string, locationId?: string) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        item_id: itemId,
        ...(locationId && { location_id: locationId }),
      },
      select: {
        id: true,
        quantity: true,
        type: true,
        reference_id: true,
        cost_basis: true,
        reason: true,
        note: true,
        value_source: true,
        override_reason: true,
        created_by_user_id: true,
        reversal_of_transaction_id: true,
        reversed_by: {
          select: { id: true },
        },
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
      orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      type: row.type,
      reference_id: row.reference_id,
      cost_basis: row.cost_basis,
      extended_value:
        row.cost_basis !== null && row.cost_basis !== undefined
          ? computeExtendedValue(row.quantity, row.cost_basis).toString()
          : null,
      reason: row.reason ?? null,
      note: row.note ?? null,
      value_source: row.value_source ?? null,
      override_reason: row.override_reason ?? null,
      created_by_user_id: row.created_by_user_id ?? null,
      reversal_of_transaction_id: row.reversal_of_transaction_id ?? null,
      reversed_by_transaction_id: row.reversed_by?.[0]?.id ?? null,
      createdAt: row.createdAt,
      item: row.item,
      location: row.location,
    }));
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
    const siteId = await this.siteContext.getSiteId();
    const [transactions, stock] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where: {
          tenant_id: tenantId,
          item_id: itemId,
          location_id: locationId,
          site_id: siteId,
        },
      }),
      this.prisma.inventoryStock.findFirst({
        where: {
          tenant_id: tenantId,
          catalog_item_id: itemId,
          location_id: locationId,
          site_id: siteId,
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
