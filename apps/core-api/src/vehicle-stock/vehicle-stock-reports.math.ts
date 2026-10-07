import { Prisma } from '@prisma/client';

export type VehicleStockAgeBucket =
  '0_30' | '31_60' | '61_90' | '91_180' | 'over_180';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysInStock(
  stockInDate: Date | null,
  asOf: Date,
): number | null {
  if (!stockInDate) return null;
  const stockInDay = Date.UTC(
    stockInDate.getUTCFullYear(),
    stockInDate.getUTCMonth(),
    stockInDate.getUTCDate(),
  );
  const asOfDay = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  return Math.max(0, Math.floor((asOfDay - stockInDay) / MILLISECONDS_PER_DAY));
}

export function stockAgeBucket(
  days: number | null,
): VehicleStockAgeBucket | null {
  if (days === null) return null;
  if (days <= 30) return '0_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  if (days <= 180) return '91_180';
  return 'over_180';
}

export function calculateGrossMargin(
  salePrice: Prisma.Decimal,
  costBasisSnapshot: Prisma.Decimal,
): Prisma.Decimal {
  return salePrice.sub(costBasisSnapshot);
}

export function calculateMarginPercent(
  grossMargin: Prisma.Decimal,
  costBasisSnapshot: Prisma.Decimal,
): Prisma.Decimal {
  if (costBasisSnapshot.isZero()) return new Prisma.Decimal(0);
  return grossMargin.mul(100).div(costBasisSnapshot);
}
