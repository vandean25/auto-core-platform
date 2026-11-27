import {
  Prisma,
  StockAdjustmentReason,
  StockAdjustmentValueSource,
  TransactionType,
} from '@prisma/client';
import {
  batchByArticle,
  classifyProcessedOriginals,
  isRevaluationGegenbuchung,
  orderBatchBookings,
  planRevaluations,
  type RevaluationCandidate,
} from './revalue-unvalued-adjustments.plan.js';

import Decimal = Prisma.Decimal;

function candidate(
  id: string,
  quantity: number,
  itemId = `item-${id}`,
): RevaluationCandidate {
  return {
    id,
    item_id: itemId,
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
        revaluationGegenbuchung: true,
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
      expect(valued.revaluationGegenbuchung).toBeUndefined();
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

describe('orderBatchBookings (AUT-1050)', () => {
  // Review ddcc8e58: +5 and -2 on an article without an average; booking pair by pair lets the +5 open an average
  // before the -2 Gegenbuchung, which then puts 2 back that never left the pool (ends at 5 instead of 3).
  it('books every Gegenbuchung before the valued rows, and valued inbounds before valued outbounds', () => {
    const cost = {
      unitCost: new Decimal('10'),
      valueSource: StockAdjustmentValueSource.LAST_EK,
    };
    const { planned } = planRevaluations(
      [candidate('out-1', -2, 'item'), candidate('in-1', 5, 'item')],
      new Map([
        ['out-1', cost],
        ['in-1', cost],
      ]),
      () => 'group',
    );

    const order = orderBatchBookings(planned).map((b) => [
      b.reversalOfTransactionId ? 'gegen' : 'valued',
      new Decimal(b.quantity).toNumber(),
    ]);

    expect(order).toEqual([
      ['gegen', 2],
      ['gegen', -5],
      ['valued', 5],
      ['valued', -2],
    ]);
  });
});

describe('batchByArticle (AUT-1050)', () => {
  // Review ddcc8e58: an article split across two batches lets the second batch's Gegenbuchung see an average the first batch created.
  it('keeps all originals of one article in one batch and fills batches up to the size', () => {
    const batches = batchByArticle(
      [
        candidate('a1', 1, 'A'),
        candidate('b1', 1, 'B'),
        candidate('a2', -1, 'A'),
        candidate('c1', 1, 'C'),
        candidate('c2', 1, 'C'),
        candidate('c3', 1, 'C'),
      ],
      3,
    );

    expect(batches.map((b) => b.map((c) => c.id))).toEqual([
      ['a1', 'a2', 'b1'],
      ['c1', 'c2', 'c3'],
    ]);
  });

  it('gives an article with more originals than the batch size a batch of its own', () => {
    const batches = batchByArticle(
      [
        candidate('b1', 1, 'B'),
        candidate('a1', 1, 'A'),
        candidate('a2', 1, 'A'),
        candidate('a3', 1, 'A'),
      ],
      2,
    );

    expect(batches.map((b) => b.map((c) => c.id))).toEqual([
      ['b1'],
      ['a1', 'a2', 'a3'],
    ]);
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
