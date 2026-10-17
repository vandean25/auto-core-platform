import { BadRequestException } from '@nestjs/common';
import {
  isoWeekMondayUtc,
  parseIsoWeekLabel,
  resolveWeeklyReportPeriod,
} from './weekly-report-period.util.js';

describe('weekly-report-period.util', () => {
  it('maps ISO week 2026-W42 to the expected Monday and Sunday in Vienna', () => {
    expect(isoWeekMondayUtc(2026, 42)).toBe('2026-10-12');
    const period = resolveWeeklyReportPeriod({
      iso_week: '2026-W42',
      timeZone: 'Europe/Vienna',
    });
    expect(period).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
      iso_week: '2026-W42',
    });
  });

  it('accepts an explicit Monday–Sunday range in the site timezone', () => {
    const period = resolveWeeklyReportPeriod({
      from: '2026-10-12',
      to: '2026-10-18',
      timeZone: 'Europe/Vienna',
    });
    expect(period.from).toBe('2026-10-12');
    expect(period.to).toBe('2026-10-18');
    expect(period.iso_week).toBeNull();
  });

  it('rejects invalid iso_week labels', () => {
    expect(() => parseIsoWeekLabel('2026-42')).toThrow(BadRequestException);
  });

  it('rejects from after to', () => {
    expect(() =>
      resolveWeeklyReportPeriod({
        from: '2026-10-18',
        to: '2026-10-12',
        timeZone: 'Europe/Vienna',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects ranges that do not start on Monday', () => {
    expect(() =>
      resolveWeeklyReportPeriod({
        from: '2026-10-13',
        to: '2026-10-19',
        timeZone: 'Europe/Vienna',
      }),
    ).toThrow(BadRequestException);
  });
});
