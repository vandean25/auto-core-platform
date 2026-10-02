export type YearMonth = {
  year: number;
  month: number;
};

export function parseYearMonthString(value: string): YearMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid year-month: ${value}`);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid year-month: ${value}`);
  }
  return { year, month };
}

export function formatYearMonth({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function toYearMonthFromDate(date: Date): YearMonth {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

export function addMonths(anchor: YearMonth, months: number): YearMonth {
  const zeroBased = anchor.year * 12 + (anchor.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return { year, month };
}

export function addYears(anchor: YearMonth, years: number): YearMonth {
  return addMonths(anchor, years * 12);
}

export function endOfMonthUtc(anchor: YearMonth): Date {
  return new Date(Date.UTC(anchor.year, anchor.month, 0, 23, 59, 59, 999));
}

export function startOfMonthUtc(anchor: YearMonth): Date {
  return new Date(Date.UTC(anchor.year, anchor.month - 1, 1, 0, 0, 0, 0));
}

export function compareUtcDates(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}
