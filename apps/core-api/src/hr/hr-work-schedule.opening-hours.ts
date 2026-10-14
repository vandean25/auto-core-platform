import type { WorkshopOpeningHour } from '@prisma/client';
import type { ScheduleDayInput } from './hr-work-schedule.types.js';

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const LAST_DEFAULT_WORKING_WEEKDAY = 5;
const DEFAULT_OPEN_TIME = '07:30';
const DEFAULT_CLOSE_TIME = '17:00';

export function mapOpeningHoursToScheduleDays(
  openingHours: WorkshopOpeningHour[],
): ScheduleDayInput[] {
  if (openingHours.length === 0) {
    return defaultScheduleDays();
  }

  const byWeekday = new Map(openingHours.map((hour) => [hour.weekday, hour]));
  return ALL_WEEKDAYS.map((weekday) =>
    toScheduleDayFromOpeningHour(weekday, byWeekday.get(weekday)),
  );
}

export function defaultScheduleDays(): ScheduleDayInput[] {
  return ALL_WEEKDAYS.map((weekday) => ({
    weekday,
    is_working: false,
    start_time: null,
    end_time: null,
    break_minutes: 0,
  }));
}

function toScheduleDayFromOpeningHour(
  weekday: number,
  opening: WorkshopOpeningHour | undefined,
): ScheduleDayInput {
  const isWorking = opening
    ? !opening.is_closed
    : weekday <= LAST_DEFAULT_WORKING_WEEKDAY;
  return {
    weekday,
    is_working: isWorking,
    start_time: isWorking ? (opening?.open_time ?? DEFAULT_OPEN_TIME) : null,
    end_time: isWorking ? (opening?.close_time ?? DEFAULT_CLOSE_TIME) : null,
    break_minutes: 0,
  };
}
