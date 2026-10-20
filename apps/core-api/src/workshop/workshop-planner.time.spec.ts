import {
  addIsoDays,
  eachLocalDate,
  formatUtcDate,
  isValidIsoDate,
  isoMondayOnOrBefore,
} from './workshop-planner.time.js';

describe('workshop-planner.time', () => {
  describe('eachLocalDate', () => {
    it('keeps the end exclusive across the Vienna daylight-saving transition', () => {
      expect(
        eachLocalDate(
          new Date('2026-03-27T23:00:00Z'),
          new Date('2026-03-29T22:00:00Z'),
          'Europe/Vienna',
        ),
      ).toEqual(['2026-03-28', '2026-03-29']);
    });

    it('returns no dates for an empty range', () => {
      const boundary = new Date('2026-12-31T23:00:00Z');
      expect(eachLocalDate(boundary, boundary, 'Europe/Vienna')).toEqual([]);
    });
  });
  describe('addIsoDays', () => {
    it('rolls over month and year boundaries', () => {
      expect(addIsoDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('respects leap years', () => {
      expect(addIsoDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addIsoDays('2026-02-28', 1)).toBe('2026-03-01');
    });
  });

  describe('isoMondayOnOrBefore', () => {
    it('returns the Monday of the ISO week for every weekday', () => {
      expect(isoMondayOnOrBefore('2026-10-12')).toBe('2026-10-12'); // Monday
      expect(isoMondayOnOrBefore('2026-10-14')).toBe('2026-10-12'); // Wednesday
      expect(isoMondayOnOrBefore('2026-10-17')).toBe('2026-10-12'); // Saturday
      expect(isoMondayOnOrBefore('2026-10-18')).toBe('2026-10-12'); // Sunday ends the week
    });
  });

  describe('isValidIsoDate', () => {
    it('accepts real calendar dates only', () => {
      expect(isValidIsoDate('2026-02-28')).toBe(true);
      expect(isValidIsoDate('2028-02-29')).toBe(true);
      expect(isValidIsoDate('2026-02-29')).toBe(false);
      expect(isValidIsoDate('2026-1-5')).toBe(false);
      expect(isValidIsoDate('not-a-date')).toBe(false);
    });
  });

  describe('formatUtcDate', () => {
    it('formats the UTC calendar day', () => {
      expect(formatUtcDate(new Date('2026-10-12T00:00:00.000Z'))).toBe(
        '2026-10-12',
      );
    });
  });
});
