import { derivePlannedSwapOn, isDueForSwap } from './tyre-storage-season.helpers.js';

const defaultSettings = {
  summer_swap_month: 3,
  summer_swap_day: 1,
  winter_swap_month: 10,
  winter_swap_day: 1,
};

describe('tyre-storage-season.helpers', () => {
  it('derives summer swap for winter sets after the winter boundary', () => {
    const asOf = new Date(Date.UTC(2026, 1, 15));
    const planned = derivePlannedSwapOn('WINTER', defaultSettings, asOf);
    expect(planned?.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('rolls winter swap into next year when already past October', () => {
    const asOf = new Date(Date.UTC(2026, 10, 15));
    const planned = derivePlannedSwapOn('SUMMER', defaultSettings, asOf);
    expect(planned?.toISOString().slice(0, 10)).toBe('2027-10-01');
  });

  it('flags sets inside the due window', () => {
    const asOf = new Date(Date.UTC(2026, 2, 20));
    const planned = new Date(Date.UTC(2026, 2, 25));
    expect(isDueForSwap(planned, 30, asOf)).toBe(true);
    expect(isDueForSwap(planned, 3, asOf)).toBe(false);
  });

  it('due window: day before first day inside, swap day, and overdue', () => {
    const plannedSwap = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01
    const dueDays = 30;

    const dayBeforeWindow = new Date(Date.UTC(2026, 0, 29)); // window ends 2026-02-28
    expect(isDueForSwap(plannedSwap, dueDays, dayBeforeWindow)).toBe(false);

    const firstDayInside = new Date(Date.UTC(2026, 0, 30)); // window ends 2026-03-01
    expect(isDueForSwap(plannedSwap, dueDays, firstDayInside)).toBe(true);

    const onSwapDay = new Date(Date.UTC(2026, 2, 1));
    expect(isDueForSwap(plannedSwap, dueDays, onSwapDay)).toBe(true);

    const overdue = new Date(Date.UTC(2026, 5, 1));
    expect(isDueForSwap(plannedSwap, dueDays, overdue)).toBe(true);
  });

  it('rolls planned swap across year boundary when asOf is late in season', () => {
    const asOf = new Date(Date.UTC(2026, 11, 15));
    const planned = derivePlannedSwapOn('SUMMER', defaultSettings, asOf);
    expect(planned?.toISOString().slice(0, 10)).toBe('2027-10-01');
  });

  it('derives Mar 1 summer swap for winter sets and opens due window on Jan 30', () => {
    const asOf = new Date(Date.UTC(2026, 1, 15));
    const planned = derivePlannedSwapOn('WINTER', defaultSettings, asOf);
    expect(planned?.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(isDueForSwap(planned, 30, new Date(Date.UTC(2026, 0, 29)))).toBe(
      false,
    );
    expect(isDueForSwap(planned, 30, new Date(Date.UTC(2026, 0, 30)))).toBe(
      true,
    );
  });
});
