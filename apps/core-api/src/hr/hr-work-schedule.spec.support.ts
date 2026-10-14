import type { ScheduleWithDays } from './hr-work-schedule.types.js';

export function createWeek() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    isWorking: weekday <= 5,
    startTime: weekday <= 5 ? '07:30' : null,
    endTime: weekday <= 5 ? '17:00' : null,
    breakMinutes: 0,
  }));
}

export function createSchedule(
  id = 'schedule-1',
  effectiveFrom = '2026-01-01',
): ScheduleWithDays {
  return {
    id,
    site_id: 'site-1',
    effective_from: new Date(`${effectiveFrom}T00:00:00.000Z`),
    days: createWeek().map((day, index) => ({
      id: `day-${index + 1}`,
      tenant_id: 'tenant-1',
      schedule_id: id,
      weekday: day.weekday,
      is_working: day.isWorking,
      start_time: day.startTime,
      end_time: day.endTime,
      break_minutes: day.breakMinutes,
    })),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
