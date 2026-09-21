import { Prisma } from '@prisma/client';
import {
  allocateCreditLineAmounts,
  computeRemainingLineBalances,
  type OriginalLineSnapshot,
  type PriorCreditLine,
} from './credit-note-allocation.js';

const d = (value: string) => new Prisma.Decimal(value);

describe('credit-note-allocation', () => {
  const originalLines: OriginalLineSnapshot[] = [
    {
      id: 'line-a',
      quantity: d('2.000'),
      net: d('100.00'),
      tax: d('20.00'),
      gross: d('120.00'),
    },
    {
      id: 'line-b',
      quantity: d('3.000'),
      net: d('30.00'),
      tax: d('6.00'),
      gross: d('36.00'),
    },
  ];

  it('allocates proportional amounts for a partial credit', () => {
    const allocation = allocateCreditLineAmounts({
      original: originalLines[0],
      creditQuantity: d('1.000'),
      priorCredits: [],
    });

    expect(allocation.net.toFixed(2)).toBe('50.00');
    expect(allocation.tax.toFixed(2)).toBe('10.00');
    expect(allocation.gross.toFixed(2)).toBe('60.00');
  });

  it('consumes exact remaining cents on the final partial credit', () => {
    const priorCredits: PriorCreditLine[] = [
      {
        originalItemId: 'line-a',
        quantity: d('1.000'),
        net: d('50.00'),
        tax: d('10.00'),
        gross: d('60.00'),
      },
    ];

    const allocation = allocateCreditLineAmounts({
      original: originalLines[0],
      creditQuantity: d('1.000'),
      priorCredits,
    });

    expect(allocation.net.toFixed(2)).toBe('50.00');
    expect(allocation.tax.toFixed(2)).toBe('10.00');
    expect(allocation.gross.toFixed(2)).toBe('60.00');
  });

  it('tracks remaining quantities and money across finalized credits', () => {
    const priorCredits: PriorCreditLine[] = [
      {
        originalItemId: 'line-a',
        quantity: d('1.000'),
        net: d('50.00'),
        tax: d('10.00'),
        gross: d('60.00'),
      },
      {
        originalItemId: 'line-b',
        quantity: d('1.000'),
        net: d('10.00'),
        tax: d('2.00'),
        gross: d('12.00'),
      },
    ];

    const remaining = computeRemainingLineBalances(originalLines, priorCredits);

    expect(remaining.get('line-a')?.quantity.toFixed(3)).toBe('1.000');
    expect(remaining.get('line-a')?.net.toFixed(2)).toBe('50.00');
    expect(remaining.get('line-b')?.quantity.toFixed(3)).toBe('2.000');
    expect(remaining.get('line-b')?.gross.toFixed(2)).toBe('24.00');
  });
});
