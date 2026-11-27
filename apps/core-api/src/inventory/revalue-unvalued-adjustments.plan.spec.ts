import {
  Prisma,
  StockAdjustmentReason,
  StockAdjustmentValueSource,
  TransactionType,
} from '@prisma/client';
import {
  classifyProcessedOriginals,
  isRevaluationGegenbuchung,
  planRevaluations,
  type RevaluationCandidate,
} from './revalue-unvalued-adjustments.plan.js';

import Decimal = Prisma.Decimal;

function candidate(id: string, quantity: number): RevaluationCandidate {
  return {
    id,
    item_id: `item-${id}`,
    location_id: 'bin-1',
    site_id: 'site-1',
    quantity: new Decimal(quantity),
    reason: StockAdjustmentReason.INVENTORY_COUNT,
  };
}

describe('planRevaluations (AUT-1050)', () => {
  // Catches a pair that changes net stock or values the Gegenbuchung instead of only the new booking.
  it.each([1, -2.5])(
    'books a Gegenbuchung and a valued booking whose quantities cancel for original qty %p',
    (qty) => {
      const { planned, gaps } = planRevaluations(
        [candidate('orig-1', qty)],
        new Map([
          [
            'orig-1',
            {
              unitCost: new Decimal('4.5'),
              valueSource: StockAdjustmentValueSource.AVG,
            },
          ],
        ]),
        () => 'group-1',
      );

      expect(gaps).toEqual([]);
      const [reversal, valued] = planned[0].bookings;
      expect(reversal).toMatchObject({
        type: TransactionType.ADJUSTMENT,
        referenceId: 'manual-adjustment-reversal',
        reversalOfTransactionId: 'orig-1',
        costBasis: null,
        valueSource: null,
        valuationNeutral: true,
        note: 'nachbewertet',
        movementGroupId: 'group-1',
      });
      expect(valued).toMatchObject({
        type: TransactionType.ADJUSTMENT,
        referenceId: 'manual-adjustment-revaluation',
        costBasis: new Decimal('4.5'),
        valueSource: StockAdjustmentValueSource.AVG,
        note: 'nachbewertet',
        createdByUserId: null,
        movementGroupId: 'group-1',
      });
      expect(valued.reversalOfTransactionId).toBeUndefined();
      expect(valued.valuationNeutral).toBeUndefined();
      const net = new Decimal(qty)
        .add(new Decimal(reversal.quantity))
        .add(new Decimal(valued.quantity));
      expect(net.toString()).toBe(new Decimal(qty).toString());
    },
  );

  // Catches inventing a value (0 or a default) for an article without average or last EK.
  it('reports originals without a resolved unit cost as gaps and plans nothing for them', () => {
    const { planned, gaps } = planRevaluations(
      [candidate('valued', 1), candidate('gap', 1)],
      new Map([
        [
          'valued',
          {
            unitCost: new Decimal('7.25'),
            valueSource: StockAdjustmentValueSource.LAST_EK,
          },
        ],
        ['gap', { unitCost: null, valueSource: null }],
      ]),
      () => 'group',
    );

    expect(planned.map((p) => p.original.id)).toEqual(['valued']);
    expect(planned[0].valueSource).toBe(StockAdjustmentValueSource.LAST_EK);
    expect(gaps.map((g) => g.id)).toEqual(['gap']);
  });
});

describe('isRevaluationGegenbuchung (AUT-1050)', () => {
  // Catches a valuation backfill that replays the Gegenbuchung into the pool (or skips a manual reversal).
  it.each([
    [
      {
        note: 'nachbewertet',
        reversal_of_transaction_id: 'orig',
        cost_basis: null,
      },
      true,
    ],
    [
      {
        note: 'Zählfehler',
        reversal_of_transaction_id: 'orig',
        cost_basis: null,
      },
      false,
    ],
    [
      {
        note: 'nachbewertet',
        reversal_of_transaction_id: null,
        cost_basis: null,
      },
      false,
    ],
    [
      {
        note: 'nachbewertet',
        reversal_of_transaction_id: 'orig',
        cost_basis: new Decimal('4.5'),
      },
      false,
    ],
  ])('classifies %o as %p', (row, expected) => {
    expect(isRevaluationGegenbuchung(row)).toBe(expected);
  });
});

describe('classifyProcessedOriginals (AUT-1050)', () => {
  // Catches a manual reversal being reported as nachbewertet (or the other way round) on the idempotent rerun.
  it('separates originals reversed by a nachbewertet Gegenbuchung from manually reversed ones', () => {
    expect(
      classifyProcessedOriginals([
        { id: 'a', reversed_by: [{ note: 'nachbewertet' }] },
        { id: 'b', reversed_by: [{ note: 'Zählfehler' }] },
        { id: 'c', reversed_by: [{ note: null }] },
      ]),
    ).toEqual({ alreadyRevalued: ['a'], alreadyReversed: ['b', 'c'] });
  });
});
