import { Prisma } from '@prisma/client';
import {
  calculateGrossMargin,
  calculateMarginPercent,
  daysInStock,
  stockAgeBucket,
} from './vehicle-stock-reports.math.js';
import { costBasis } from './vehicle-cost.js';

describe('vehicle stock report calculations', () => {
  it.each([
    [0, '0_30'],
    [30, '0_30'],
    [31, '31_60'],
    [60, '31_60'],
    [61, '61_90'],
    [90, '61_90'],
    [91, '91_180'],
    [180, '91_180'],
    [181, 'over_180'],
  ] as const)('places %i days in bucket %s', (days, bucket) => {
    expect(stockAgeBucket(days)).toBe(bucket);
  });

  it('keeps a vehicle with no stock-in date and no age bucket', () => {
    expect(daysInStock(null, new Date('2026-10-06T12:00:00Z'))).toBeNull();
    expect(stockAgeBucket(null)).toBeNull();
  });

  it('counts completed calendar days from the stock-in date', () => {
    expect(
      daysInStock(
        new Date('2026-10-01T23:00:00Z'),
        new Date('2026-10-06T01:00:00Z'),
      ),
    ).toBe(5);
  });

  it('includes workshop cost and adjustments in current cost basis', () => {
    const basis = costBasis([
      { entry_type: 'PURCHASE', amount: new Prisma.Decimal('10000.00') },
      { entry_type: 'WORKSHOP_COST', amount: new Prisma.Decimal('250.50') },
      { entry_type: 'ADJUSTMENT', amount: new Prisma.Decimal('49.50') },
      { entry_type: 'SALE', amount: new Prisma.Decimal('13000.00') },
    ]);

    expect(basis.toFixed(2)).toBe('10300.00');
  });

  it('calculates margin from the supplied immutable cost snapshot with Decimal precision', () => {
    const snapshot = new Prisma.Decimal('10000.00');
    const margin = calculateGrossMargin(
      new Prisma.Decimal('12499.99'),
      snapshot,
    );

    expect(margin.toFixed(2)).toBe('2499.99');
    expect(
      calculateMarginPercent(margin, new Prisma.Decimal('12499.99')).toFixed(2),
    ).toBe('20.00');
    expect(snapshot.toFixed(2)).toBe('10000.00');
  });

  it('calculates taxable margin VAT without floating-point arithmetic', () => {
    const gross = new Prisma.Decimal('2500.00')
      .mul(new Prisma.Decimal('20'))
      .div(new Prisma.Decimal('120'))
      .toDecimalPlaces(2);

    expect(gross.toFixed(2)).toBe('416.67');
  });
});
