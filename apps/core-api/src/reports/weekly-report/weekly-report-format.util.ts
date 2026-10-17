import { Prisma } from '@prisma/client';

const EUR_FORMATTER = new Intl.NumberFormat('de-AT', {
  style: 'currency',
  currency: 'EUR',
});

const PERCENT_FORMATTER = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatEurAmount(
  value: Prisma.Decimal | string | number,
): string {
  const numeric =
    value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  return EUR_FORMATTER.format(numeric);
}

export function formatPercent(
  value: Prisma.Decimal | string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') {
    return '–';
  }
  const numeric =
    value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  if (Number.isNaN(numeric)) {
    return '–';
  }
  return `${PERCENT_FORMATTER.format(numeric)} %`;
}

const NUMBER_FORMATTER = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDecimalString(value: string | null | undefined): string {
  if (!value) {
    return '–';
  }
  return formatEurAmount(value);
}

/** Plain numeric ratio or quantity (not a currency amount). */
export function formatNumberString(value: string | null | undefined): string {
  if (!value) {
    return '–';
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return '–';
  }
  return NUMBER_FORMATTER.format(numeric);
}

export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ?? 1;
}
