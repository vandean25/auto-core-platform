import type { EmployeeWorkScheduleVersionResponseDto } from './dto/hr-work-schedule.dto.js';
import type { ScheduleWithDays } from './hr-work-schedule.types.js';

export function toScheduleDateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function toScheduleVersionResponse(
  schedule: ScheduleWithDays,
): EmployeeWorkScheduleVersionResponseDto {
  return {
    id: schedule.id,
    effectiveFrom: schedule.effective_from.toISOString().slice(0, 10),
    siteId: schedule.site_id,
    days: schedule.days.map((day) => ({
      id: day.id,
      weekday: day.weekday,
      isWorking: day.is_working,
      startTime: day.start_time,
      endTime: day.end_time,
      breakMinutes: day.break_minutes,
    })),
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

export function findCurrentSchedule(
  history: ScheduleWithDays[],
  todayMs: number,
): ScheduleWithDays | null {
  let current: ScheduleWithDays | null = null;
  for (const schedule of history) {
    if (schedule.effective_from.getTime() <= todayMs) {
      current = schedule;
    }
  }
  return current;
}
