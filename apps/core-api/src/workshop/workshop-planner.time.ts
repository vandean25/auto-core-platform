export function isoWeekdayFromUtcDate(
  year: number,
  month: number,
  day: number,
): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function formatLocalDate(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseLocalDate(isoDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

export function zonedWallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = localOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offsetMs);
}

function localOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function eachLocalDate(
  from: Date,
  to: Date,
  timeZone: string,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(from.getTime());
  const end = new Date(to.getTime() - 1);
  if (end.getTime() < from.getTime()) {
    return dates;
  }
  let current = formatLocalDate(cursor, timeZone);
  const last = formatLocalDate(end, timeZone);
  while (current <= last) {
    dates.push(current);
    current = addIsoDays(current, 1);
  }
  return dates;
}

export function parseHhMm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
}

export function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const { year, month, day } = parseLocalDate(value);
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day))) === value;
}

/** Calendar arithmetic on a `YYYY-MM-DD` string; no timezone involved. */
export function addIsoDays(isoDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(isoDate);
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/** Monday of the ISO week (Mon–Sun) that contains `isoDate`. */
export function isoMondayOnOrBefore(isoDate: string): string {
  const { year, month, day } = parseLocalDate(isoDate);
  return addIsoDays(isoDate, 1 - isoWeekdayFromUtcDate(year, month, day));
}
