import { HrWorkScheduleService } from './hr-work-schedule.service';
import { averageExpectedMinutesPerWorkday } from './hr-work-schedule.time';

describe('HrWorkScheduleService', () => {
  it('uses the 480-minute fallback when no opening hours exist', () => {
    const service = new HrWorkScheduleService({} as never, {} as never);

    const days = service.mapOpeningHoursToScheduleDays([]);

    expect(days).toHaveLength(7);
    expect(days.every((day) => !day.is_working)).toBe(true);
    expect(averageExpectedMinutesPerWorkday(days)).toBe(480);
  });
});
