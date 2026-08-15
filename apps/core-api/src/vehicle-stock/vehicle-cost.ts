import { Prisma } from '@prisma/client';

const COST_BASIS_TYPES = new Set(['PURCHASE', 'WORKSHOP_COST', 'ADJUSTMENT']);

export function costBasis(
  entries: Array<{ entry_type: string; amount: Prisma.Decimal }>,
): Prisma.Decimal {
  return entries.reduce((sum, entry) => {
    if (!COST_BASIS_TYPES.has(entry.entry_type)) {
      return sum;
    }
    return sum.add(entry.amount);
  }, new Prisma.Decimal(0));
}

export function marginVatGross(
  salePrice: Prisma.Decimal,
  basis: Prisma.Decimal,
  taxRatePercent: Prisma.Decimal,
): Prisma.Decimal {
  const margin = salePrice.sub(basis);
  if (margin.lte(0)) {
    return new Prisma.Decimal(0);
  }
  return margin
    .mul(taxRatePercent)
    .div(taxRatePercent.add(100))
    .toDecimalPlaces(2);
}
