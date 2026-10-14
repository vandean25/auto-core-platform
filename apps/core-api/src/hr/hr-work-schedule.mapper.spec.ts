import {
  findCurrentSchedule,
  toScheduleDateOnly,
  toScheduleVersionResponse,
} from './hr-work-schedule.mapper.js';
import { createSchedule } from './hr-work-schedule.spec.support.js';

describe('hr-work-schedule.mapper', () => {
  it('parses a date-only value as UTC midnight', () => {
    expect(toScheduleDateOnly('2026-09-01').toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('maps a schedule version to the response shape', () => {
    const response = toScheduleVersionResponse(createSchedule());

    expect(response).toEqual(
      expect.objectContaining({
        id: 'schedule-1',
        effectiveFrom: '2026-01-01',
        siteId: 'site-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    expect(response.days).toHaveLength(7);
    expect(response.days[0]).toEqual({
      id: 'day-1',
      weekday: 1,
      isWorking: true,
      startTime: '07:30',
      endTime: '17:00',
      breakMinutes: 0,
    });
  });

  it('returns the latest version effective on or before the given day', () => {
    const history = [
      createSchedule('early', '2020-01-01'),
      createSchedule('current', '2026-06-01'),
      createSchedule('future', '2099-01-01'),
    ];

    const current = findCurrentSchedule(
      history,
      toScheduleDateOnly('2026-10-14').getTime(),
    );

    expect(current?.id).toBe('current');
  });

  it('returns null when every version starts after the given day', () => {
    const history = [createSchedule('future', '2099-01-01')];

    expect(
      findCurrentSchedule(history, toScheduleDateOnly('2026-10-14').getTime()),
    ).toBeNull();
  });

  it('returns null for an empty history', () => {
    expect(findCurrentSchedule([], 0)).toBeNull();
  });
});
