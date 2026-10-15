/**
 * Gewährleistung status shared by the due list and the vehicle and sale badges.
 * "Today" is the Europe/Vienna calendar day. Stored `@db.Date` values are compared by the
 * calendar day they hold (their UTC date), the same way compute-gewaehrleistung.ts reads them.
 */

/** A Basisfrist is "expiring soon" within the shortest due-list window (`endsWithinDays=30`). */
export const GEWAEHRLEISTUNG_EXPIRING_SOON_DAYS = 30;

export type GewaehrleistungStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';

const VIENNA_DAY_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna',
});

/** The Europe/Vienna calendar day of an instant, as `YYYY-MM-DD`. */
export function viennaIsoDay(now: Date): string {
  return VIENNA_DAY_FORMATTER.format(now);
}

/** Adds whole calendar days to a `YYYY-MM-DD` day. The result never depends on the local time zone. */
export function addIsoDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Start and end instants of the due-list window; both edge days are inclusive. */
export function gewaehrleistungDueWindow(
  today: string,
  endsWithinDays: number,
) {
  return {
    windowStart: new Date(`${today}T00:00:00.000Z`),
    windowEnd: new Date(`${addIsoDays(today, endsWithinDays)}T23:59:59.999Z`),
  };
}

function storedDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A period is expired once its end day is before today. The end day itself is still running. */
export function isPeriodExpired(
  endsOn: Date | null | undefined,
  today: string,
): boolean {
  return endsOn ? storedDay(endsOn) < today : false;
}

/** The Basisfrist badge: expired, expiring soon (due within the window), or active. */
export function deriveGewaehrleistungStatus(
  endsOn: Date | null | undefined,
  today: string,
): GewaehrleistungStatus | null {
  if (!endsOn) return null;
  if (isPeriodExpired(endsOn, today)) return 'EXPIRED';
  const expiringSoonUntil = addIsoDays(
    today,
    GEWAEHRLEISTUNG_EXPIRING_SOON_DAYS,
  );
  return storedDay(endsOn) <= expiringSoonUntil ? 'EXPIRING_SOON' : 'ACTIVE';
}
