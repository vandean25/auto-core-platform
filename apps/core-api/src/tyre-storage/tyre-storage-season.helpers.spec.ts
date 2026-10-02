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
});
