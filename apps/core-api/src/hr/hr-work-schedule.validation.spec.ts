import { BadRequestException } from '@nestjs/common';
import { createWeek } from './hr-work-schedule.spec.support.js';
import { assertValidScheduleDays } from './hr-work-schedule.validation.js';

describe('assertValidScheduleDays', () => {
  it('accepts a full week with one row per weekday', () => {
    expect(() => assertValidScheduleDays(createWeek())).not.toThrow();
  });

  it('rejects a week that does not have exactly seven days', () => {
    expect(() => assertValidScheduleDays(createWeek().slice(1))).toThrow(
      'days must include each weekday 1–7 exactly once',
    );
  });

  it('rejects a weekday that is repeated', () => {
    const week = createWeek();
    week[6] = { ...week[6], weekday: 1 };

    expect(() => assertValidScheduleDays(week)).toThrow(BadRequestException);
  });

  it('rejects a weekday outside 1 to 7', () => {
    const week = createWeek();
    week[0] = { ...week[0], weekday: 8 };

    expect(() => assertValidScheduleDays(week)).toThrow(
      'days must include each weekday 1–7 exactly once',
    );
  });

  it('rejects times on a day that is not working', () => {
    const week = createWeek();
    week[5] = { ...week[5], startTime: '08:00', endTime: '12:00' };

    expect(() => assertValidScheduleDays(week)).toThrow(
      'Weekday 6 must not have times when isWorking is false',
    );
  });

  it('requires start and end times on a working day', () => {
    const week = createWeek();
    week[0] = { ...week[0], startTime: null };

    expect(() => assertValidScheduleDays(week)).toThrow(
      'Weekday 1 requires startTime and endTime',
    );
  });

  it('rejects an end time that is not after the start time', () => {
    const week = createWeek();
    week[1] = { ...week[1], startTime: '17:00', endTime: '07:30' };

    expect(() => assertValidScheduleDays(week)).toThrow(
      'Weekday 2 endTime must be after startTime',
    );
  });

  it('rejects a break that is not shorter than the work window', () => {
    const week = createWeek();
    week[2] = { ...week[2], breakMinutes: 570 };

    expect(() => assertValidScheduleDays(week)).toThrow(
      'Weekday 3 breakMinutes must be less than the work window',
    );
  });
});
