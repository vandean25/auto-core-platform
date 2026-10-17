import { computePickerlDue } from './compute-pickerl-due.js';
import { formatYearMonth } from './pickerl-date.util.js';
import {
  dueSoonWithinWindow,
  hasStrictDue60Bucket,
  pickPlaketteMonthInWindow,
  pickerlDueFixturesForToday,
} from './pickerl-due-window-fixtures.js';

const FIRST_REGISTRATION = '2019-06-01';

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

describe('pickerl due window fixtures', () => {
  const sampleDays = [
    '2026-01-27',
    '2026-01-31',
    '2026-02-28',
    '2028-02-29',
    '2026-10-17',
  ];

  it.each(sampleDays)(
    'places due30/due60/due90/ok in the expected 30/60/90 windows on %s',
    (isoDay) => {
      const today = utcDate(isoDay);
      const fixtures = pickerlDueFixturesForToday(today);

      expect(dueSoonWithinWindow(fixtures.due30, today, 30)).toBe(true);
      expect(dueSoonWithinWindow(fixtures.due30, today, 60)).toBe(true);
      expect(dueSoonWithinWindow(fixtures.due30, today, 90)).toBe(true);

      expect(dueSoonWithinWindow(fixtures.due60, today, 30)).toBe(false);
      expect(dueSoonWithinWindow(fixtures.due60, today, 60)).toBe(true);
      expect(dueSoonWithinWindow(fixtures.due60, today, 90)).toBe(true);

      expect(dueSoonWithinWindow(fixtures.due90, today, 30)).toBe(false);
      expect(dueSoonWithinWindow(fixtures.due90, today, 60)).toBe(false);
      expect(dueSoonWithinWindow(fixtures.due90, today, 90)).toBe(true);

      expect(dueSoonWithinWindow(fixtures.ok, today, 30)).toBe(false);
      expect(dueSoonWithinWindow(fixtures.ok, today, 60)).toBe(false);
      expect(dueSoonWithinWindow(fixtures.ok, today, 90)).toBe(false);
    },
  );

  it('has no strict due60 bucket on 2026-03-31 (month-end gap)', () => {
    const today = utcDate('2026-03-31');
    expect(hasStrictDue60Bucket(today)).toBe(false);
    expect(dueSoonWithinWindow(pickPlaketteMonthInWindow(today, null, 30), today, 30)).toBe(
      true,
    );
  });

  it.each(sampleDays)(
    'maps seeded plakette months to DUE_SOON / OK statuses on %s',
    (isoDay) => {
      const today = utcDate(isoDay);
      const fixtures = pickerlDueFixturesForToday(today);
      const vehicle = { first_registration_date: FIRST_REGISTRATION };

      const due30 = computePickerlDue(
        vehicle,
        [
          {
            inspected_on: '2020-01-01',
            plaketten_valid_until_year: fixtures.due30.year,
            plaketten_valid_until_month: fixtures.due30.month,
          },
        ],
        today,
      );
      expect(due30.status).toBe('DUE_SOON');
      expect(due30.due_month).toBe(formatYearMonth(fixtures.due30));

      const ok = computePickerlDue(
        vehicle,
        [
          {
            inspected_on: '2020-01-01',
            plaketten_valid_until_year: fixtures.ok.year,
            plaketten_valid_until_month: fixtures.ok.month,
          },
        ],
        today,
      );
      expect(ok.status).toBe('OK');
      expect(ok.due_month).toBe(formatYearMonth(fixtures.ok));
    },
  );
});
