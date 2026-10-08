import { Prisma } from '@prisma/client';
import {
  averageDailyStockValue,
  calculateAvailableHours,
  calculatePartsTurnover,
  calculateProductivity,
  calculateUtilisation,
  reportPeriodKey,
  splitLaborIntervalByPeriod,
} from './workshop-kpi-reports.math.js';

describe('workshop KPI report math', () => {
  it('deducts approved leave and closed holidays from scheduled capacity', () => {
    const hours = calculateAvailableHours([
      { scheduledMinutes: 480, approvedLeaveMinutes: 120, workshopClosed: false },
      { scheduledMinutes: 450, approvedLeaveMinutes: 0, workshopClosed: true },
    ]);

    expect(hours.toFixed(2)).toBe('6.00');
  });

  it('returns null utilisation when no hours are available', () => {
    expect(calculateUtilisation(new Prisma.Decimal(0), new Prisma.Decimal(0))).toBeNull();
  });

  it('returns null productivity when no labour was clocked', () => {
    expect(calculateProductivity(new Prisma.Decimal(0), new Prisma.Decimal(0))).toBeNull();
  });

  it('calculates utilisation and productivity as percentages', () => {
    expect(calculateUtilisation(new Prisma.Decimal(6), new Prisma.Decimal(8))?.toFixed(2)).toBe('75.00');
    expect(calculateProductivity(new Prisma.Decimal(5), new Prisma.Decimal(8))?.toFixed(2)).toBe('62.50');
  });

  it('labels dates with ISO week-year at the year boundary', () => {
    expect(reportPeriodKey('2026-12-31', 'week')).toBe('2026-W53');
    expect(reportPeriodKey('2027-01-01', 'week')).toBe('2026-W53');
  });

  it('splits a closed labour interval across tenant-local month boundaries', () => {
    const periods = splitLaborIntervalByPeriod(
      new Date('2026-01-31T22:30:00.000Z'),
      new Date('2026-02-01T02:00:00.000Z'),
      'Europe/Vienna',
      'month',
    );

    expect(periods.map(({ period, hours }) => [period, hours.toFixed(2)])).toEqual([
      ['2026-01', '0.50'],
      ['2026-02', '3.00'],
    ]);
  });

  it('averages historical daily stock value without floating point arithmetic', () => {
    const value = averageDailyStockValue([
      new Prisma.Decimal('100.00'),
      new Prisma.Decimal('200.00'),
      new Prisma.Decimal('300.00'),
    ]);

    expect(value?.toFixed(2)).toBe('200.00');
  });

  it('returns null turnover when average site stock value is zero', () => {
    expect(
      calculatePartsTurnover(new Prisma.Decimal(40), new Prisma.Decimal(0)),
    ).toBeNull();
  });

  it('calculates parts turnover from period issue cost over average historical stock', () => {
    const averageValue = averageDailyStockValue([
      new Prisma.Decimal('100.00'),
      new Prisma.Decimal('300.00'),
    ]);

    expect(calculatePartsTurnover(new Prisma.Decimal('80.00'), averageValue!)?.toFixed(2)).toBe('0.40');
  });
});
