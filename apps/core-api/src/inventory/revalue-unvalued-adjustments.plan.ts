import {
  Prisma,
  StockAdjustmentReason,
  StockAdjustmentValueSource,
  TransactionType,
} from '@prisma/client';
import type { RecordTransactionParams } from './ledger.service.js';

import Decimal = Prisma.Decimal;

/** Stable, queryable marker on both rows of a revaluation pair (AUT-1050). */
export const REVALUATION_NOTE = 'nachbewertet';
export const REVALUATION_REFERENCE = 'manual-adjustment-revaluation';
export const MANUAL_ADJUSTMENT_REFERENCE = 'manual-adjustment';
export const MANUAL_ADJUSTMENT_REVERSAL_REFERENCE =
  'manual-adjustment-reversal';
/** Originals per database transaction (an article is never split); a failure rolls back only its own batch. */
export const REVALUATION_BATCH_SIZE = 100;

export interface RevaluationCandidate {
  id: string;
  item_id: string;
  location_id: string;
  site_id: string;
  quantity: Decimal;
  reason: StockAdjustmentReason | null;
}

export interface ResolvedAdjustmentCost {
  unitCost: Decimal | null;
  valueSource: StockAdjustmentValueSource | null;
}

export interface PlannedRevaluation {
  original: RevaluationCandidate;
  unitCost: Decimal;
  valueSource: StockAdjustmentValueSource;
  movementGroupId: string;
  /** Gegenbuchung first, then the new valued booking. */
  bookings: [RecordTransactionParams, RecordTransactionParams];
}

/**
 * The Gegenbuchung of a revaluation pair unwinds quantity only. Live bookings flag it explicitly;
 * the valuation backfill recognises it by these persisted fields so a replay ends at the same pool.
 */
export function isRevaluationGegenbuchung(row: {
  note: string | null;
  reversal_of_transaction_id: string | null;
  cost_basis: Decimal | null;
}): boolean {
  return (
    row.note === REVALUATION_NOTE &&
    row.reversal_of_transaction_id !== null &&
    row.cost_basis === null
  );
}

/**
 * Packs originals into batches of up to `size` without splitting an article: the Gegenbuchung decides from the
 * pool as it was before the run, so a later batch must not see an average an earlier batch created.
 * An article with more originals than `size` gets a batch of its own.
 */
export function batchByArticle(
  candidates: readonly RevaluationCandidate[],
  size: number,
): RevaluationCandidate[][] {
  const byArticle = new Map<string, RevaluationCandidate[]>();
  for (const c of candidates) {
    const group = byArticle.get(c.item_id) ?? [];
    group.push(c);
    byArticle.set(c.item_id, group);
  }
  const batches: RevaluationCandidate[][] = [];
  let current: RevaluationCandidate[] = [];
  for (const group of byArticle.values()) {
    if (current.length > 0 && current.length + group.length > size) {
      batches.push(current);
      current = [];
    }
    current = current.concat(group);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Ledger order for one batch: every Gegenbuchung first, so each sees the pool as it was before the run
 * (it puts an unvalued outbound back only if an average existed then); then the valued inbounds, then the
 * valued outbounds, so an article without a prior average is opened before it is reduced.
 * The backfill replays rows in this same seq order and lands on the same pool.
 */
export function orderBatchBookings(
  planned: readonly PlannedRevaluation[],
): RecordTransactionParams[] {
  const valued = planned.map((p) => p.bookings[1]);
  const isInbound = (b: RecordTransactionParams) =>
    new Decimal(b.quantity).gt(0);
  return [
    ...planned.map((p) => p.bookings[0]),
    ...valued.filter(isInbound),
    ...valued.filter((b) => !isInbound(b)),
  ];
}

/** Splits originals that already have a reversal into revalued (marker on the Gegenbuchung) and otherwise reversed. */
export function classifyProcessedOriginals(
  rows: ReadonlyArray<{
    id: string;
    reversed_by: ReadonlyArray<{ note: string | null }>;
  }>,
): { alreadyRevalued: string[]; alreadyReversed: string[] } {
  const alreadyRevalued: string[] = [];
  const alreadyReversed: string[] = [];
  for (const row of rows) {
    if (
      row.reversed_by.some((reversal) => reversal.note === REVALUATION_NOTE)
    ) {
      alreadyRevalued.push(row.id);
    } else {
      alreadyReversed.push(row.id);
    }
  }
  return { alreadyRevalued, alreadyReversed };
}

/**
 * Plans one Gegenbuchung (opposite quantity, original's null cost) plus one valued ADJUSTMENT per original.
 * Originals without a resolved unit cost become gaps: no value is invented.
 */
export function planRevaluations(
  candidates: readonly RevaluationCandidate[],
  costByOriginalId: ReadonlyMap<string, ResolvedAdjustmentCost>,
  newMovementGroupId: () => string,
): { planned: PlannedRevaluation[]; gaps: RevaluationCandidate[] } {
  const planned: PlannedRevaluation[] = [];
  const gaps: RevaluationCandidate[] = [];
  for (const original of candidates) {
    const cost = costByOriginalId.get(original.id);
    if (!cost?.unitCost || !cost.valueSource) {
      gaps.push(original);
      continue;
    }
    const movementGroupId = newMovementGroupId();
    const shared = {
      itemId: original.item_id,
      locationId: original.location_id,
      type: TransactionType.ADJUSTMENT,
      reason: original.reason,
      note: REVALUATION_NOTE,
      createdByUserId: null,
      movementGroupId,
    };
    planned.push({
      original,
      unitCost: cost.unitCost,
      valueSource: cost.valueSource,
      movementGroupId,
      bookings: [
        {
          ...shared,
          quantity: new Decimal(original.quantity).neg(),
          referenceId: MANUAL_ADJUSTMENT_REVERSAL_REFERENCE,
          costBasis: null,
          valueSource: null,
          revaluationGegenbuchung: true,
          reversalOfTransactionId: original.id,
        },
        {
          ...shared,
          quantity: new Decimal(original.quantity),
          referenceId: REVALUATION_REFERENCE,
          costBasis: cost.unitCost,
          valueSource: cost.valueSource,
        },
      ],
    });
  }
  return { planned, gaps };
}
