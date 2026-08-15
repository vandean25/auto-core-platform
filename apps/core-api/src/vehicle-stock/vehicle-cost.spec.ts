import { Prisma } from '@prisma/client';
import { costBasis, marginVatGross } from './vehicle-cost';

describe('vehicle-cost', () => {
  describe('marginVatGross', () => {
    it('computes VAT on positive margin using gross method at 20%', () => {
      const vat = marginVatGross(
        new Prisma.Decimal('12000'),
        new Prisma.Decimal('10000'),
        new Prisma.Decimal('20'),
      );
      expect(vat.toFixed(2)).toBe('333.33');
    });

    it('returns zero when sale price is not greater than cost', () => {
      const vat = marginVatGross(
        new Prisma.Decimal('9000'),
        new Prisma.Decimal('10000'),
        new Prisma.Decimal('20'),
      );
      expect(vat.toFixed(2)).toBe('0.00');
    });
  });

  describe('costBasis', () => {
    it('sums purchase, workshop cost, and adjustment and ignores sale', () => {
      const basis = costBasis([
        { entry_type: 'PURCHASE', amount: new Prisma.Decimal('10000') },
        { entry_type: 'WORKSHOP_COST', amount: new Prisma.Decimal('500') },
        { entry_type: 'ADJUSTMENT', amount: new Prisma.Decimal('-100') },
        { entry_type: 'SALE', amount: new Prisma.Decimal('-12000') },
      ]);
      expect(basis.toFixed(2)).toBe('10400.00');
    });
  });
});
