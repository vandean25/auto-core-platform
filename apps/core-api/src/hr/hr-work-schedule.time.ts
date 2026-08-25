import { BadRequestException } from '@nestjs/common';
import { EmployeeWorkScheduleDay } from '@prisma/client';

export const FALLBACK_AVG_WORKDAY_MINUTES = 480;

export function workdayMinutesFromTimes(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): number {
  const [openHour, openMinute] = startTime.split(':').map(Number);
  const [closeHour, closeMinute] = endTime.split(':').map(Number);
  const grossSpan = closeHour * 60 + closeMinute - (openHour * 60 + openMinute);
  if (grossSpan <= 0) {
    throw new BadRequestException(
      'Work schedule end time must be after start time',
    );
  }
  if (breakMinutes < 0 || breakMinutes >= grossSpan) {
    throw new BadRequestException(
      'Work schedule break must be shorter than the workday',
    );
  }
  return grossSpan - breakMinutes;
}

export function expectedMinutesForScheduleDay(
  day: Pick<
    EmployeeWorkScheduleDay,
    'is_working' | 'start_time' | 'end_time' | 'break_minutes'
  >,
): number {
  if (!day.is_working) {
    return 0;
  }
  if (day.start_time == null || day.end_time == null) {
    throw new BadRequestException(
      'Working schedule days require start and end times',
    );
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
