import { EmployeeWorkScheduleDay } from '@prisma/client';

export const FALLBACK_AVG_WORKDAY_MINUTES = 480;

export function workdayMinutesFromTimes(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): number {
  const [openHour, openMinute] = startTime.split(':').map(Number);
  const [closeHour, closeMinute] = endTime.split(':').map(Number);
  const span =
    closeHour * 60 + closeMinute - (openHour * 60 + openMinute) - breakMinutes;
  return Math.max(0, span);
}

export function expectedMinutesForScheduleDay(
  day: Pick<
    EmployeeWorkScheduleDay,
    'is_working' | 'start_time' | 'end_time' | 'break_minutes'
  >,
): number {
  if (
    !day.is_working ||
    day.start_time == null ||
    day.end_time == null ||
    day.end_time <= day.start_time
  ) {
    return 0;
  }
  return workdayMinutesFromTimes(
    day.start_time,
    day.end_time,
    day.break_minutes,
  );
}

export function averageExpectedMinutesPerWorkday(
  days: Pick<
    EmployeeWorkScheduleDay,
    'is_working' | 'start_time' | 'end_time' | 'break_minutes'
  >[],
): number {
  const working = days.filter((day) => day.is_working);
  if (working.length === 0) {
    return FALLBACK_AVG_WORKDAY_MINUTES;
  }
  const total = working.reduce(
    (sum, day) => sum + expectedMinutesForScheduleDay(day),
    0,
  );
  return Math.round(total / working.length);
}

export function daysToMinutes(
  days: number,
  avgMinutesPerWorkday: number,
): number {
  return Math.round(days * avgMinutesPerWorkday);
}
