/** Minutes since midnight of `now` in the given IANA time zone. */
export function minutesOfDayInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  return (hour % 24) * 60 + minute;
}

/**
 * Whether `now` falls in the quiet hours [start, end) of the zone. An overnight window (start after end, for
 * example 22:00 to 06:00) wraps past midnight. No window, or a window with equal ends, is never quiet.
 */
export function isInQuietHours(
  now: Date,
  timeZone: string,
  startMin: number | null,
  endMin: number | null,
): boolean {
  if (startMin === null || endMin === null || startMin === endMin) {
    return false;
  }
  const minute = minutesOfDayInZone(now, timeZone);
  if (startMin < endMin) {
    return minute >= startMin && minute < endMin;
  }
  return minute >= startMin || minute < endMin;
}
