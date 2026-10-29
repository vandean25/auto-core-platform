export type TyreDot = {
  format: 'MODERN' | 'LEGACY_PRE_2000';
  productionWeek: number;
  productionYear: number | null;
  productionDate: string | null;
  ageMonths: number | null;
  minimumAgeMonths: number;
};

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

function completedMonths(start: Date, end: Date): number {
  return Math.max(
    0,
    (end.getUTCFullYear() - start.getUTCFullYear()) * MONTHS_PER_YEAR +
      end.getUTCMonth() -
      start.getUTCMonth() -
      Number(end.getUTCDate() < start.getUTCDate()),
  );
}

function weekMonday(year: number, week: number): Date {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekday = (januaryFourth.getUTCDay() + 6) % DAYS_PER_WEEK;
  januaryFourth.setUTCDate(4 - weekday + (week - 1) * DAYS_PER_WEEK);
  return januaryFourth;
}

export function parseTyreDot(dot: string, asOf: Date): TyreDot {
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error('TYRE_EVALUATION_DATE_INVALID');
  }
  const suffix = /(\d{4}|\d{3})$/.exec(dot.trim())?.[1];
  if (!suffix) throw new Error('TYRE_DOT_INVALID_FORMAT');
  const week = Number(suffix.slice(0, 2));
  if (week < 1 || week > 53) throw new Error('TYRE_DOT_INVALID_WEEK');
  if (suffix.length === 3) {
    return {
      format: 'LEGACY_PRE_2000',
      productionWeek: week,
      productionYear: null,
      productionDate: null,
      ageMonths: null,
      minimumAgeMonths: completedMonths(new Date('2000-01-01T00:00:00Z'), asOf),
    };
  }
  const year = 2000 + Number(suffix.slice(2));
  const production = weekMonday(year, week);
  if (production >= weekMonday(year + 1, 1)) {
    throw new Error('TYRE_DOT_INVALID_WEEK');
  }
  if (production > asOf) throw new Error('TYRE_DOT_FUTURE_DATE');
  const ageMonths = completedMonths(production, asOf);
  return {
    format: 'MODERN',
    productionWeek: week,
    productionYear: year,
    productionDate: production.toISOString().slice(0, 10),
    ageMonths,
    minimumAgeMonths: ageMonths,
  };
}
