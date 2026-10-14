import { BadRequestException } from '@nestjs/common';
import type { CreateEmployeeWorkScheduleDto } from './dto/hr-work-schedule.dto.js';

type ScheduleDayPayload = CreateEmployeeWorkScheduleDto['days'][number];

const WEEKDAY_COUNT = 7;

export function assertValidScheduleDays(
  days: CreateEmployeeWorkScheduleDto['days'],
): void {
  assertEachWeekdayOnce(days);
  for (const day of days) {
    assertScheduleDayTimes(day);
  }
}

function assertEachWeekdayOnce(days: ScheduleDayPayload[]): void {
  const weekdays = days.map((day) => day.weekday);
  if (
    days.length !== WEEKDAY_COUNT ||
    new Set(weekdays).size !== WEEKDAY_COUNT ||
    weekdays.some((weekday) => weekday < 1 || weekday > WEEKDAY_COUNT)
  ) {
    throw new BadRequestException(
      'days must include each weekday 1–7 exactly once',
    );
  }
}

function assertScheduleDayTimes(day: ScheduleDayPayload): void {
  const startTime = day.startTime ?? null;
  const endTime = day.endTime ?? null;

  if (!day.isWorking) {
    if (startTime !== null || endTime !== null) {
      throw new BadRequestException(
        `Weekday ${day.weekday} must not have times when isWorking is false`,
      );
    }
    return;
  }

  if (!startTime || !endTime) {
    throw new BadRequestException(
      `Weekday ${day.weekday} requires startTime and endTime`,
    );
  }
  assertWorkWindow(day, startTime, endTime);
}

function assertWorkWindow(
  day: ScheduleDayPayload,
  startTime: string,
  endTime: string,
): void {
  const span = timeToMinutes(endTime) - timeToMinutes(startTime);
  if (span <= 0) {
    throw new BadRequestException(
      `Weekday ${day.weekday} endTime must be after startTime`,
    );
  }
  if (day.breakMinutes >= span) {
    throw new BadRequestException(
      `Weekday ${day.weekday} breakMinutes must be less than the work window`,
    );
  }
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
