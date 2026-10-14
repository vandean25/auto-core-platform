import type { WorkshopOpeningHour } from '@prisma/client';
import {
  defaultScheduleDays,
  mapOpeningHoursToScheduleDays,
} from './hr-work-schedule.opening-hours.js';

function openingHour(
  weekday: number,
  overrides: Partial<WorkshopOpeningHour> = {},
): WorkshopOpeningHour {
  return {
    id: `hour-${weekday}`,
    tenant_id: 'tenant-1',
    weekday,
    is_closed: false,
    open_time: '08:00',
    close_time: '18:00',
    ...overrides,
  } as WorkshopOpeningHour;
}

describe('mapOpeningHoursToScheduleDays', () => {
  it('returns seven closed days when no opening hours exist', () => {
    const days = mapOpeningHoursToScheduleDays([]);

    expect(days).toEqual(defaultScheduleDays());
    expect(days.every((day) => !day.is_working)).toBe(true);
  });

  it('uses the configured times and closures for each weekday', () => {
    const days = mapOpeningHoursToScheduleDays([
      openingHour(1),
      openingHour(2, { is_closed: true }),
    ]);

    expect(days[0]).toEqual({
      weekday: 1,
      is_working: true,
      start_time: '08:00',
      end_time: '18:00',
      break_minutes: 0,
    });
    expect(days[1]).toEqual({
      weekday: 2,
      is_working: false,
      start_time: null,
      end_time: null,
      break_minutes: 0,
    });
  });

  it('treats weekdays without a row as Monday to Friday at 07:30 to 17:00', () => {
    const days = mapOpeningHoursToScheduleDays([openingHour(1)]);

    expect(days[2]).toEqual({
      weekday: 3,
      is_working: true,
      start_time: '07:30',
      end_time: '17:00',
      break_minutes: 0,
    });
    expect(days[5].is_working).toBe(false);
    expect(days[6].is_working).toBe(false);
  });

  it('returns one entry per weekday in order', () => {
    const days = mapOpeningHoursToScheduleDays([openingHour(7)]);

    expect(days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
