import {
  assertClosedExportPeriod,
  assertValidExportDateRange,
  buildExportDocumentDateFilter,
  exclusiveUtcEndOfDateOnly,
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

  it('uses exclusive UTC end for inclusive date-only ranges', () => {
    const dateTo = new Date('2026-01-31T00:00:00.000Z');
    const filter = buildExportDocumentDateFilter(
      new Date('2026-01-01T00:00:00.000Z'),
      dateTo,
    );

    expect(filter.lt).toEqual(exclusiveUtcEndOfDateOnly(dateTo));
    expect(
      new Date('2026-01-31T12:00:00.000Z') >= filter.gte &&
        new Date('2026-01-31T12:00:00.000Z') < filter.lt,
    ).toBe(true);
    expect(new Date('2026-02-01T00:00:00.000Z') < filter.lt).toBe(false);
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
