import { Prisma } from '@prisma/client';

export function calculateAvailableHours(
  days: readonly {
    scheduledMinutes: number;
    approvedLeaveMinutes: number;
    workshopClosed: boolean;
  }[],
): Prisma.Decimal {
  const availableMinutes = days.reduce((total, day) => {
    if (day.workshopClosed) {
      return total;
    }
    return total + Math.max(0, day.scheduledMinutes - day.approvedLeaveMinutes);
  }, 0);
  return new Prisma.Decimal(availableMinutes).dividedBy(60);
}

export function calculateUtilisation(
  clockedHours: Prisma.Decimal,
  availableHours: Prisma.Decimal,
): Prisma.Decimal | null {
  if (availableHours.isZero()) {
    return null;
  }
  return clockedHours.dividedBy(availableHours).mul(100);
}

export function calculateProductivity(
  soldHours: Prisma.Decimal,
  clockedHours: Prisma.Decimal,
): Prisma.Decimal | null {
  if (clockedHours.isZero()) {
    return null;
  }
  return soldHours.dividedBy(clockedHours).mul(100);
}

type CalendarParts = {
  year: number;
  month: number;
  day: number;
};

const DATE_PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function calendarPartsAt(date: Date, timeZone: string): CalendarParts {
  let formatter = DATE_PARTS_FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    DATE_PARTS_FORMATTER_CACHE.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function dateLabel({ year, month, day }: CalendarParts): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localMidnightUtc(
  { year, month, day }: CalendarParts,
  timeZone: string,
): Date {
  const targetUtc = Date.UTC(year, month - 1, day);
  let guess = targetUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const localParts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(localParts.find((part) => part.type === type)?.value);
    const representedUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    const nextGuess = targetUtc - (representedUtc - guess);
    if (nextGuess === guess) break;
    guess = nextGuess;
  }
  return new Date(guess);
}

function nextPeriodStart(
  localDate: CalendarParts,
  groupBy: 'week' | 'month',
): CalendarParts {
  if (groupBy === 'month') {
    return localDate.month === 12
      ? { year: localDate.year + 1, month: 1, day: 1 }
      : { year: localDate.year, month: localDate.month + 1, day: 1 };
  }
  const current = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day),
  );
  const isoWeekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + (8 - isoWeekday));
  return {
    year: current.getUTCFullYear(),
    month: current.getUTCMonth() + 1,
    day: current.getUTCDate(),
  };
}

function periodLabel(
  localDate: CalendarParts,
  groupBy: 'week' | 'month',
): string {
  if (groupBy === 'month') {
    return `${localDate.year}-${String(localDate.month).padStart(2, '0')}`;
  }
  const monday = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day),
  );
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() || 7) - 4),
  );
  const week =
    Math.floor((thursday.getTime() - firstThursday.getTime()) / 604_800_000) +
    1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function reportPeriodKey(
  isoDate: string,
  groupBy: 'week' | 'month',
): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return periodLabel({ year, month, day }, groupBy);
}

export function localDateStartUtc(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return localMidnightUtc({ year, month, day }, timeZone);
}

export function localDateForInstant(date: Date, timeZone: string): string {
  return dateLabel(calendarPartsAt(date, timeZone));
}

export function splitLaborIntervalByPeriod(
  startedAt: Date,
  endedAt: Date,
  timeZone: string,
  groupBy: 'week' | 'month',
): Array<{ period: string; hours: Prisma.Decimal }> {
  const startMs = startedAt.getTime();
  const endMs = endedAt.getTime();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return [];
  }

  const totals = new Map<string, number>();
  let segmentStart = startMs;
  while (segmentStart < endMs) {
    const localDate = calendarPartsAt(new Date(segmentStart), timeZone);
    const nextStart = localMidnightUtc(
      nextPeriodStart(localDate, groupBy),
      timeZone,
    ).getTime();
    const segmentEnd = Math.min(
      endMs,
      nextStart > segmentStart ? nextStart : endMs,
    );
    const key = periodLabel(localDate, groupBy);
    totals.set(key, (totals.get(key) ?? 0) + (segmentEnd - segmentStart));
    segmentStart = segmentEnd;
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, durationMs]) => ({
      period,
      hours: new Prisma.Decimal(durationMs).dividedBy(3_600_000),
    }));
}

export function averageDailyStockValue(
  dailyValues: readonly Prisma.Decimal[],
): Prisma.Decimal | null {
  if (dailyValues.length === 0) {
    return null;
  }
  const total = dailyValues.reduce(
    (sum, value) => sum.plus(value),
    new Prisma.Decimal(0),
  );
  return total.dividedBy(dailyValues.length);
}

export function calculatePartsTurnover(
  issuedCost: Prisma.Decimal,
  averageStockValue: Prisma.Decimal,
): Prisma.Decimal | null {
  if (averageStockValue.isZero()) {
    return null;
  }
  return issuedCost.dividedBy(averageStockValue);
}
