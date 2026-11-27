import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  applyValuationStep,
  isTransferTransactionType,
  type ValuationState,
} from './inventory-valuation.math.js';
import { isRevaluationGegenbuchung } from './revalue-unvalued-adjustments.plan.js';

import Decimal = Prisma.Decimal;

const ZERO = new Decimal(0);

export interface ValuationBookingInput {
  itemId: string;
  siteId: string;
  quantity: Decimal | number | string;
  type: TransactionType;
  costBasis?: Decimal | number | string | null;
  isReversal?: boolean;
  /** AUT-1050 Gegenbuchung: moves quantity only, skips the moving-average step. */
  valuationNeutral?: boolean;
}

export interface PreparedValuationBatch {
  stampedCostBasisByIndex: Array<Decimal | null>;
  commit: (
    maxSeqByIndex: ReadonlyMap<number, bigint>,
    asOf?: Date,
  ) => Promise<void>;
}

export interface BackfillGapItem {
  legalEntityId: string;
  catalogItemId: string;
  unvaluedInboundCount: number;
  unvaluedOutboundCount: number;
  transactionIds: string[];
}

export interface BackfillValuationReport {
  processedTransactions: number;
  valuationsUpserted: number;
  gapCount: number;
  gaps: BackfillGapItem[];
}

interface ValuationKey {
  legalEntityId: string;
  catalogItemId: string;
}

interface ValuationRowSnapshot {
  id: string;
  legal_entity_id: string;
  catalog_item_id: string;
  average_unit_cost: Decimal | null;
  valued_quantity: Decimal;
  last_booking_seq: bigint | null;
}

function valuationKey(legalEntityId: string, catalogItemId: string): string {
  return `${legalEntityId}:${catalogItemId}`;
}

function emptyState(): ValuationState {
  return {
    averageUnitCost: null,
    valuedQuantity: ZERO,
  };
}

function toOptionalDecimal(
  value: Decimal | number | string | null | undefined,
): Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }
  return new Decimal(value.toString());
}

async function resolveBookingKeys(
  tx: Prisma.TransactionClient,
  tenantId: string,
  nonTransferBookings: ReadonlyArray<{
    b: ValuationBookingInput;
    index: number;
  }>,
): Promise<{
  sortedKeys: ValuationKey[];
  legalEntityByIndex: Map<number, string>;
}> {
  const siteIds = [...new Set(nonTransferBookings.map(({ b }) => b.siteId))];
  const sites = await tx.site.findMany({
    where: { tenant_id: tenantId, id: { in: siteIds } },
    select: { id: true, legal_entity_id: true },
  });
  const legalEntityBySite = new Map(
    sites.map((site) => [site.id, site.legal_entity_id]),
  );

  const uniqueKeysMap = new Map<string, ValuationKey>();
  const legalEntityByIndex = new Map<number, string>();

  for (const { b, index } of nonTransferBookings) {
    const legalEntityId = legalEntityBySite.get(b.siteId);
    if (!legalEntityId) {
      throw new BadRequestException(
        `Site ${b.siteId} is missing a legal entity`,
      );
    }
    legalEntityByIndex.set(index, legalEntityId);
    const key = valuationKey(legalEntityId, b.itemId);
    if (!uniqueKeysMap.has(key)) {
      uniqueKeysMap.set(key, { legalEntityId, catalogItemId: b.itemId });
    }
  }

  const sortedKeys = [...uniqueKeysMap.values()].sort(
    (a, b) =>
      a.legalEntityId.localeCompare(b.legalEntityId) ||
      a.catalogItemId.localeCompare(b.catalogItemId),
  );
  return { sortedKeys, legalEntityByIndex };
}

const BACKFILL_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const;

type BoundRawQuery = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

function valuationAdvisoryLockKey(tenantId: string): string {
  return `inventory_valuation:${tenantId}`;
}

async function acquireValuationSharedLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const executeRaw = tx['$executeRaw'].bind(tx) as BoundRawQuery;
  const lockMaterial = valuationAdvisoryLockKey(tenantId);
  await executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${lockMaterial}::text, 0))`;
}

async function acquireValuationExclusiveLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const executeRaw = tx['$executeRaw'].bind(tx) as BoundRawQuery;
  const lockMaterial = valuationAdvisoryLockKey(tenantId);
  await executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockMaterial}::text, 0))`;
}

async function lockValuationRows(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sortedValuationIds: readonly string[],
): Promise<void> {
  if (sortedValuationIds.length === 0) {
    return;
  }
  const queryRaw = tx['$queryRaw'].bind(tx) as BoundRawQuery;
  await queryRaw`
    SELECT id
    FROM inventory_valuations
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedValuationIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

async function lockAndLoadValuations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sortedKeys: readonly ValuationKey[],
): Promise<ValuationRowSnapshot[]> {
  await tx.inventoryValuation.createMany({
    data: sortedKeys.map((k) => ({
      tenant_id: tenantId,
      legal_entity_id: k.legalEntityId,
      catalog_item_id: k.catalogItemId,
      average_unit_cost: null,
      valued_quantity: ZERO,
    })),
    skipDuplicates: true,
  });

  const existingIdRows = await tx.inventoryValuation.findMany({
    where: {
      tenant_id: tenantId,
      OR: sortedKeys.map((k) => ({
        legal_entity_id: k.legalEntityId,
        catalog_item_id: k.catalogItemId,
      })),
    },
    select: { id: true },
  });
  const valuationIds = [...new Set(existingIdRows.map((row) => row.id))].sort();
  if (valuationIds.length === 0) {
    return [];
  }

  await lockValuationRows(tx, tenantId, valuationIds);

  return tx.inventoryValuation.findMany({
    where: { tenant_id: tenantId, id: { in: valuationIds } },
  });
}

function maxBookingSeq(
  current: bigint | null,
  indices: readonly number[],
  maxSeqByIndex: ReadonlyMap<number, bigint>,
): bigint | undefined {
  let maxSeq: bigint | undefined = current ?? undefined;
  for (const index of indices) {
    const seq = maxSeqByIndex.get(index);
    if (seq !== undefined && (maxSeq === undefined || seq > maxSeq)) {
      maxSeq = seq;
    }
  }
  return maxSeq;
}

@Injectable()
export class InventoryValuationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures and row-locks the InventoryValuation rows for all non-transfer bookings
   * in the batch, computes updated moving-average state and stamped outbound cost_basis,
   * and returns a commit callback to persist the updated valuation + last_booking_seq
   * after InventoryTransaction rows are inserted.
   *
   * Never scans historical InventoryTransaction rows.
   */
  async prepareAndLockBatch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    bookings: readonly ValuationBookingInput[],
  ): Promise<PreparedValuationBatch> {
    const stampedCostBasisByIndex = bookings.map((b) =>
      toOptionalDecimal(b.costBasis),
    );
    const nonTransferIndices = bookings
      .map((b, index) => ({ b, index }))
      .filter(({ b }) => !isTransferTransactionType(b.type));

    if (nonTransferIndices.length === 0) {
      return {
        stampedCostBasisByIndex,
        commit: () => Promise.resolve(),
      };
    }

    await acquireValuationSharedLock(tx, tenantId);

    const { sortedKeys, legalEntityByIndex } = await resolveBookingKeys(
      tx,
      tenantId,
      nonTransferIndices,
    );
    const lockedRows = await lockAndLoadValuations(tx, tenantId, sortedKeys);

    const rowByKey = new Map(
      lockedRows.map((row) => [
        valuationKey(row.legal_entity_id, row.catalog_item_id),
        row,
      ]),
    );
    const stateByKey = new Map<string, ValuationState>(
      [...rowByKey.entries()].map(([key, row]) => [
        key,
        {
          averageUnitCost: row.average_unit_cost
            ? new Decimal(row.average_unit_cost)
            : null,
          valuedQuantity: new Decimal(row.valued_quantity),
        },
      ]),
    );

    const dirtyKeys = new Set<string>();
    const indicesByKey = new Map<string, number[]>();

    for (const { b, index } of nonTransferIndices) {
      const legalEntityId = legalEntityByIndex.get(index)!;
      const key = valuationKey(legalEntityId, b.itemId);
      const step = applyValuationStep(stateByKey.get(key) ?? emptyState(), {
        type: b.type,
        quantity: b.quantity,
        costBasis: b.costBasis,
        isReversal: b.isReversal,
        valuationNeutral: b.valuationNeutral,
      });

      stateByKey.set(key, step.state);
      stampedCostBasisByIndex[index] = step.stampedCostBasis;
      dirtyKeys.add(key);

      const list = indicesByKey.get(key) ?? [];
      list.push(index);
      indicesByKey.set(key, list);
    }

    const commit = async (
      maxSeqByIndex: ReadonlyMap<number, bigint>,
      asOf: Date = new Date(),
    ): Promise<void> => {
      const updates = [...dirtyKeys]
        .map((key) => {
          const row = rowByKey.get(key);
          const nextState = stateByKey.get(key);
          if (!row || !nextState) return null;
          const maxSeq = maxBookingSeq(
            row.last_booking_seq,
            indicesByKey.get(key) ?? [],
            maxSeqByIndex,
          );
          return { rowId: row.id, nextState, maxSeq };
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);

      await chunkedPromiseAll(updates, (update) =>
        tx.inventoryValuation.updateMany({
          where: { id: update.rowId, tenant_id: tenantId },
          data: {
            average_unit_cost: update.nextState.averageUnitCost,
            valued_quantity: update.nextState.valuedQuantity,
            as_of: asOf,
            ...(update.maxSeq !== undefined
              ? { last_booking_seq: update.maxSeq }
              : {}),
          },
        }),
      );
    };

    return { stampedCostBasisByIndex, commit };
  }

  /**
   * Shared Last-EK resolver for AUT-1048 / AUT-1050 when no InventoryValuation average exists.
   * Order (first match wins):
   *  1. Latest PURCHASE_RECEIPT.cost_basis for the article in the same legal entity
   *  2. CatalogItem.cost_price
   *  3. Newest VendorArticle.last_cost
   *  4. null
   */
  async resolveLastEk(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    legalEntityId: string,
    catalogItemId: string,
  ): Promise<Decimal | null> {
    const fromReceipt = await this.findLatestReceiptCost(
      tx,
      tenantId,
      legalEntityId,
      catalogItemId,
    );
    if (fromReceipt) return fromReceipt;

    const catalogItem = await tx.catalogItem.findFirst({
      where: { tenant_id: tenantId, id: catalogItemId },
      select: { cost_price: true },
    });
    if (catalogItem?.cost_price != null) {
      return new Decimal(catalogItem.cost_price);
    }

    const vendorArticle = await tx.vendorArticle.findFirst({
      where: {
        tenant_id: tenantId,
        catalog_item_id: catalogItemId,
        last_cost: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { last_cost: true },
    });
    return vendorArticle?.last_cost != null
      ? new Decimal(vendorArticle.last_cost)
      : null;
  }

  private async findLatestReceiptCost(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    legalEntityId: string,
    catalogItemId: string,
  ): Promise<Decimal | null> {
    const sites = await tx.site.findMany({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      select: { id: true },
    });
    const siteIds = sites.map((s) => s.id);
    if (siteIds.length === 0) return null;

    const latestReceipt = await tx.inventoryTransaction.findFirst({
      where: {
        tenant_id: tenantId,
        item_id: catalogItemId,
        site_id: { in: siteIds },
        type: TransactionType.PURCHASE_RECEIPT,
        cost_basis: { not: null },
      },
      orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
      select: { cost_basis: true },
    });
    return latestReceipt?.cost_basis != null
      ? new Decimal(latestReceipt.cost_basis)
      : null;
  }

  /**
   * Idempotent initial backfill from the existing InventoryTransaction journal per legal entity and article.
   * Tolerates null cost_basis gaps and reports them without inventing a cost.
   */
  async backfillTenant(
    tenantId: string,
    txClient?: Prisma.TransactionClient,
    txOptions?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<BackfillValuationReport> {
    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<BackfillValuationReport> => {
      await acquireValuationExclusiveLock(tx, tenantId);

      const sites = await tx.site.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, legal_entity_id: true },
      });
      const siteIds = sites.map((site) => site.id);
      const transactions =
        siteIds.length === 0
          ? []
          : await tx.inventoryTransaction.findMany({
              where: { tenant_id: tenantId, site_id: { in: siteIds } },
              orderBy: [{ seq: 'asc' }],
              select: {
                id: true,
                seq: true,
                site_id: true,
                item_id: true,
                quantity: true,
                type: true,
                cost_basis: true,
                note: true,
                reversal_of_transaction_id: true,
                createdAt: true,
              },
            });

      const legalEntityBySite = new Map(
        sites.map((site) => [site.id, site.legal_entity_id]),
      );

      const states = new Map<
        string,
        {
          legalEntityId: string;
          catalogItemId: string;
          state: ValuationState;
          asOf: Date;
          lastSeq: bigint;
        }
      >();
      const gapsMap = new Map<string, BackfillGapItem>();

      for (const row of transactions) {
        if (isTransferTransactionType(row.type)) continue;
        const legalEntityId = legalEntityBySite.get(row.site_id);
        if (!legalEntityId) continue;

        const key = valuationKey(legalEntityId, row.item_id);
        const current = states.get(key) ?? {
          legalEntityId,
          catalogItemId: row.item_id,
          state: emptyState(),
          asOf: row.createdAt,
          lastSeq: row.seq,
        };

        const step = applyValuationStep(current.state, {
          type: row.type,
          quantity: row.quantity,
          costBasis: row.cost_basis,
          isReversal: row.reversal_of_transaction_id !== null,
          valuationNeutral: isRevaluationGegenbuchung(row),
        });

        current.state = step.state;
        current.asOf = row.createdAt;
        current.lastSeq = row.seq;
        states.set(key, current);

        if (step.isUnvaluedGap) {
          const gap = gapsMap.get(key) ?? {
            legalEntityId,
            catalogItemId: row.item_id,
            unvaluedInboundCount: 0,
            unvaluedOutboundCount: 0,
            transactionIds: [],
          };
          if (new Decimal(row.quantity).gt(0)) {
            gap.unvaluedInboundCount += 1;
          } else {
            gap.unvaluedOutboundCount += 1;
          }
          gap.transactionIds.push(row.id);
          gapsMap.set(key, gap);
        }
      }

      const entries = [...states.values()];
      await chunkedPromiseAll(entries, (entry) =>
        tx.inventoryValuation.upsert({
          where: {
            tenant_id_legal_entity_id_catalog_item_id: {
              tenant_id: tenantId,
              legal_entity_id: entry.legalEntityId,
              catalog_item_id: entry.catalogItemId,
            },
          },
          create: {
            tenant_id: tenantId,
            legal_entity_id: entry.legalEntityId,
            catalog_item_id: entry.catalogItemId,
            average_unit_cost: entry.state.averageUnitCost,
            valued_quantity: entry.state.valuedQuantity,
            as_of: entry.asOf,
            last_booking_seq: entry.lastSeq,
          },
          update: {
            average_unit_cost: entry.state.averageUnitCost,
            valued_quantity: entry.state.valuedQuantity,
            as_of: entry.asOf,
            last_booking_seq: entry.lastSeq,
          },
        }),
      );

      const gaps = [...gapsMap.values()];
      return {
        processedTransactions: transactions.length,
        valuationsUpserted: entries.length,
        gapCount: gaps.length,
        gaps,
      };
    };

    if (txClient) {
      return run(txClient);
    }
    return this.prisma.$transaction((tx) => run(tx), {
      maxWait: txOptions?.maxWaitMs ?? BACKFILL_TRANSACTION_OPTIONS.maxWait,
      timeout: txOptions?.timeoutMs ?? BACKFILL_TRANSACTION_OPTIONS.timeout,
    });
  }
}
