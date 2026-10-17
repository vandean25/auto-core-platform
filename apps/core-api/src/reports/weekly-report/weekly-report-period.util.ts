import { BadRequestException } from '@nestjs/common';
import {
  localDateStartUtc,
  reportPeriodKey,
} from '../../workshop/workshop-kpi-reports.math.js';

const ISO_WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

export type WeeklyReportPeriod = {
  from: string;
  to: string;
  iso_week: string | null;
};

export function parseIsoWeekLabel(isoWeek: string): {
  year: number;
  week: number;
} {
  const match = ISO_WEEK_PATTERN.exec(isoWeek);
  if (!match) {
    throw new BadRequestException(
      'iso_week must match YYYY-Www, for example 2026-W42',
    );
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) {
    throw new BadRequestException('iso_week week must be between 01 and 53');
  }
  return { year, week };
}

/** Monday (ISO) of the given ISO week as YYYY-MM-DD in UTC calendar parts. */
export function isoWeekMondayUtc(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

function addCalendarDaysIso(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function weekdayInTimeZone(date: string, timeZone: string): number {
  const instant = localDateStartUtc(date, timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).formatToParts(instant);
  const label = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const day = map[label];
  if (!day) {
    throw new BadRequestException(
      'Could not resolve weekday for report period',
    );
  }
  return day;
}

export function resolveWeeklyReportPeriod(input: {
  iso_week?: string;
  from?: string;
  to?: string;
  timeZone: string;
}): WeeklyReportPeriod {
  if (input.iso_week !== undefined) {
    const { year, week } = parseIsoWeekLabel(input.iso_week);
    const from = isoWeekMondayUtc(year, week);
    const canonicalWeek = reportPeriodKey(from, 'week');
    if (canonicalWeek !== input.iso_week) {
      throw new BadRequestException(
        `iso_week ${input.iso_week} does not exist in the ISO calendar`,
      );
    }
    const to = addCalendarDaysIso(from, 6);
    assertIsoWeekRange({ from, to, timeZone: input.timeZone });
    return { from, to, iso_week: input.iso_week };
  }
  if (input.from === undefined || input.to === undefined) {
    throw new BadRequestException(
      'Provide iso_week or both from and to as inclusive site-local days',
    );
  }
  if (input.from > input.to) {
    throw new BadRequestException('from must be on or before to');
  }
  const spanDays =
    (Date.parse(`${input.to}T12:00:00.000Z`) -
      Date.parse(`${input.from}T12:00:00.000Z`)) /
      86_400_000 +
    1;
  if (spanDays !== 7) {
    throw new BadRequestException(
      'from and to must span exactly seven inclusive site-local days',
    );
  }
  assertIsoWeekRange({
    from: input.from,
    to: input.to,
    timeZone: input.timeZone,
  });
  return { from: input.from, to: input.to, iso_week: null };
}

function assertIsoWeekRange(params: {
  from: string;
  to: string;
  timeZone: string;
}): void {
  if (weekdayInTimeZone(params.from, params.timeZone) !== 1) {
    throw new BadRequestException(
      'Report period must start on Monday in the site timezone',
    );
  }
  if (weekdayInTimeZone(params.to, params.timeZone) !== 7) {
    throw new BadRequestException(
      'Report period must end on Sunday in the site timezone',
    );
  }
  const expectedEnd = addCalendarDaysIso(params.from, 6);
  if (expectedEnd !== params.to) {
    throw new BadRequestException(
      'from and to must be the same ISO calendar week (Monday through Sunday)',
    );
  }
}

export function periodLabelForPdf(
  period: WeeklyReportPeriod,
  timeZone: string,
) {
  const fromLabel = formatSiteLocalDate(period.from, timeZone);
  const toLabel = formatSiteLocalDate(period.to, timeZone);
  const weekSuffix = period.iso_week ? ` (${period.iso_week})` : '';
  return `${fromLabel} – ${toLabel}${weekSuffix}`;
}

export function formatSiteLocalDate(date: string, timeZone: string): string {
  const instant = localDateStartUtc(date, timeZone);
  return new Intl.DateTimeFormat('de-AT', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}

export function formatSiteLocalDateTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
