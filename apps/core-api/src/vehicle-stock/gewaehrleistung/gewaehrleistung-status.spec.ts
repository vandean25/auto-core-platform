import {
  addIsoDays,
  deriveGewaehrleistungStatus,
  gewaehrleistungDueWindow,
  isPeriodExpired,
  viennaIsoDay,
} from './gewaehrleistung-status.js';

/** Stored `@db.Date` values are UTC midnight of the calendar day. */
const storedDay = (isoDay: string) => new Date(`${isoDay}T00:00:00.000Z`);

describe('viennaIsoDay', () => {
  it('reads the Vienna calendar day, not the UTC day, after Vienna midnight', () => {
    // 22:30 UTC on 14 Oct is 00:30 on 15 Oct in Vienna (CEST, UTC+2).
    expect(viennaIsoDay(new Date('2026-10-14T22:30:00.000Z'))).toBe('2026-10-15');
    expect(viennaIsoDay(new Date('2026-10-14T21:59:59.000Z'))).toBe('2026-10-14');
  });

  it('uses winter time (UTC+1) outside daylight saving', () => {
    expect(viennaIsoDay(new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01');
  });
});

describe('addIsoDays', () => {
  it('adds calendar days across month and leap-day boundaries', () => {
    expect(addIsoDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addIsoDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addIsoDays('2026-10-15', 30)).toBe('2026-11-14');
  });
});

describe('gewaehrleistungDueWindow', () => {
  it('spans from the start of today through the end of the last window day', () => {
    expect(gewaehrleistungDueWindow('2026-10-15', 30)).toEqual({
      windowStart: new Date('2026-10-15T00:00:00.000Z'),
      windowEnd: new Date('2026-11-14T23:59:59.999Z'),
    });
  });
});

describe('isPeriodExpired', () => {
  it('marks a period expired only when its end day is before today', () => {
    expect(isPeriodExpired(storedDay('2026-10-14'), '2026-10-15')).toBe(true);
    expect(isPeriodExpired(storedDay('2026-10-15'), '2026-10-15')).toBe(false);
    expect(isPeriodExpired(null, '2026-10-15')).toBe(false);
  });
});

describe('deriveGewaehrleistungStatus', () => {
  const today = '2026-10-15';

  it('has no status without a Basisfrist end date', () => {
    expect(deriveGewaehrleistungStatus(null, today)).toBeNull();
  });

  it.each([
    ['2026-10-14', 'EXPIRED'],
    ['2026-10-15', 'EXPIRING_SOON'],
    ['2026-11-14', 'EXPIRING_SOON'],
    ['2026-11-15', 'ACTIVE'],
  ])('a Basisfrist ending %s is %s', (endsOn, expected) => {
    expect(deriveGewaehrleistungStatus(storedDay(endsOn), today)).toBe(expected);
  });

  it('uses the Vienna day, so a Basisfrist ending on the Vienna day before is already expired', () => {
    const viennaToday = viennaIsoDay(new Date('2026-10-14T22:30:00.000Z'));

    expect(deriveGewaehrleistungStatus(storedDay('2026-10-14'), viennaToday)).toBe('EXPIRED');
  });
});
