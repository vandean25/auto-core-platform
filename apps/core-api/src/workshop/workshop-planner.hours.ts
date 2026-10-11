import type { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import {
  formatUtcDate,
  isLeapYear,
  isoWeekdayFromUtcDate,
  parseLocalDate,
} from './workshop-planner.time.js';

export type EffectiveHours = {
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  holidayName?: string;
};

/**
 * Opening hours for one local date. A holiday for the date wins (a dated row
 * before an annual one); otherwise the site's weekday row applies (ADR-0019 §3).
 * Pure: the caller loads the site's holidays and opening hours.
 */
export function effectiveHours(
  isoDate: string,
  holidays: WorkshopHoliday[],
  openings: WorkshopOpeningHour[],
): EffectiveHours {
  const { year, month, day } = parseLocalDate(isoDate);
  const oneOff = holidays.find(
    (row) =>
      !row.repeats_annually && formatUtcDate(row.observed_on) === isoDate,
  );
  const annual = holidays.find((row) => {
    if (!row.repeats_annually) {
      return false;
    }
    const observed = row.observed_on;
    if (observed.getUTCMonth() + 1 === 2 && observed.getUTCDate() === 29) {
      if (!isLeapYear(year)) {
        return false;
      }
    }
    return (
      observed.getUTCMonth() + 1 === month && observed.getUTCDate() === day
    );
  });
  const holiday = oneOff ?? annual;
  if (holiday) {
    return {
      isClosed: holiday.is_closed,
      openTime: holiday.open_time,
      closeTime: holiday.close_time,
      holidayName: holiday.name,
    };
  }
  const weekday = isoWeekdayFromUtcDate(year, month, day);
  const opening = openings.find((row) => row.weekday === weekday);
  return {
    isClosed: opening?.is_closed ?? true,
    openTime: opening?.open_time ?? null,
    closeTime: opening?.close_time ?? null,
  };
}
