import {
  assertClosedExportPeriod,
  assertValidExportDateRange,
} from './accounting-export-period.js';

describe('accounting-export-period', () => {
  it('rejects reversed and cross-year ranges', () => {
    expect(() =>
      assertValidExportDateRange('2026-02-01', '2026-01-31'),
    ).toThrow();
    expect(() =>
      assertValidExportDateRange('2026-12-01', '2027-01-31'),
    ).toThrow();
  });

  it('requires a closed period through lock date', () => {
    expect(() =>
      assertClosedExportPeriod(
        new Date('2026-01-31T00:00:00.000Z'),
        null,
      ),
    ).toThrow();
    expect(() =>
      assertClosedExportPeriod(
        new Date('2026-02-01T00:00:00.000Z'),
        new Date('2026-01-31T00:00:00.000Z'),
      ),
    ).toThrow();
    expect(() =>
      assertClosedExportPeriod(
        new Date('2026-01-31T00:00:00.000Z'),
        new Date('2026-01-31T00:00:00.000Z'),
      ),
    ).not.toThrow();
  });
});
