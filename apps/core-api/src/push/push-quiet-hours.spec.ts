import { isInQuietHours, minutesOfDayInZone } from './push-quiet-hours.js';

describe('push quiet hours', () => {
  describe('minutesOfDayInZone', () => {
    it('reads the wall clock of the zone, including the summer time offset', () => {
      // 2026-07-01 12:30 UTC is 14:30 in Vienna (UTC+2).
      expect(
        minutesOfDayInZone(
          new Date('2026-07-01T12:30:00.000Z'),
          'Europe/Vienna',
        ),
      ).toBe(14 * 60 + 30);
      // 2026-12-01 12:30 UTC is 13:30 in Vienna (UTC+1).
      expect(
        minutesOfDayInZone(
          new Date('2026-12-01T12:30:00.000Z'),
          'Europe/Vienna',
        ),
      ).toBe(13 * 60 + 30);
    });

    it('reads midnight as minute 0', () => {
      expect(
        minutesOfDayInZone(
          new Date('2026-12-01T23:00:00.000Z'),
          'Europe/Vienna',
        ),
      ).toBe(0);
    });
  });

  describe('isInQuietHours', () => {
    const zone = 'Europe/Vienna';
    const at = (isoUtc: string) => new Date(isoUtc);

    it('is never quiet without a window or with equal ends', () => {
      const now = at('2026-12-01T12:00:00.000Z');
      expect(isInQuietHours(now, zone, null, null)).toBe(false);
      expect(isInQuietHours(now, zone, 600, null)).toBe(false);
      expect(isInQuietHours(now, zone, 600, 600)).toBe(false);
    });

    it('covers a same-day window from the start minute up to, not including, the end minute', () => {
      // 12:00 to 14:00 Vienna in winter = 11:00 to 13:00 UTC.
      expect(
        isInQuietHours(at('2026-12-01T10:59:00.000Z'), zone, 720, 840),
      ).toBe(false);
      expect(
        isInQuietHours(at('2026-12-01T11:00:00.000Z'), zone, 720, 840),
      ).toBe(true);
      expect(
        isInQuietHours(at('2026-12-01T12:59:00.000Z'), zone, 720, 840),
      ).toBe(true);
      expect(
        isInQuietHours(at('2026-12-01T13:00:00.000Z'), zone, 720, 840),
      ).toBe(false);
    });

    it('covers an overnight window across midnight', () => {
      // 22:00 to 06:00 Vienna in winter.
      expect(
        isInQuietHours(at('2026-12-01T20:59:00.000Z'), zone, 1320, 360),
      ).toBe(false);
      expect(
        isInQuietHours(at('2026-12-01T21:00:00.000Z'), zone, 1320, 360),
      ).toBe(true);
      expect(
        isInQuietHours(at('2026-12-01T23:30:00.000Z'), zone, 1320, 360),
      ).toBe(true);
      expect(
        isInQuietHours(at('2026-12-02T04:59:00.000Z'), zone, 1320, 360),
      ).toBe(true);
      expect(
        isInQuietHours(at('2026-12-02T05:00:00.000Z'), zone, 1320, 360),
      ).toBe(false);
    });

    it('uses the zone of the site, not UTC', () => {
      const now = at('2026-12-01T23:30:00.000Z'); // 00:30 in Vienna, 18:30 in New York
      expect(isInQuietHours(now, 'Europe/Vienna', 1320, 360)).toBe(true);
      expect(isInQuietHours(now, 'America/New_York', 1320, 360)).toBe(false);
    });
  });
});
