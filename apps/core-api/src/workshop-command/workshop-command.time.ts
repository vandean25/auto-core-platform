import {
  formatLocalDate,
  parseLocalDate,
} from '../workshop/workshop-planner.time.js';

const MINUTE_MS = 60_000;
const OFFSET_PROBE_MS = 24 * 60 * MINUTE_MS;

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

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

function wallClockOf(date: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/**
 * All UTC instants whose site-local wall clock equals the requested date and time.
 * Returns 0 for a DST gap, 2 for a DST overlap, 1 otherwise. Ordered ascending.
 */
export function resolveWallClock(
  timeZone: string,
  localDate: string,
  hhmm: string,
): Date[] {
  const { year, month, day } = parseLocalDate(localDate);
  const [hour, minute] = hhmm.split(':').map(Number);
  const requested: WallClock = { year, month, day, hour, minute };
  const base = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set<number>();
  for (const probe of [base - OFFSET_PROBE_MS, base, base + OFFSET_PROBE_MS]) {
    offsets.add(localOffsetMs(new Date(probe), timeZone));
  }

  const matches = new Map<number, Date>();
  for (const offset of offsets) {
    const candidate = new Date(base - offset);
    if (sameWallClock(wallClockOf(candidate, timeZone), requested)) {
      matches.set(candidate.getTime(), candidate);
    }
  }
  return [...matches.values()].sort((a, b) => a.getTime() - b.getTime());
}

export function addLocalDays(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function localDateOf(instant: Date, timeZone: string): string {
  return formatLocalDate(instant, timeZone);
}

/** Offset in minutes east of UTC for one resolved instant, used for DST choice labels. */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  return Math.round(localOffsetMs(instant, timeZone) / MINUTE_MS);
}

export function isDaylightSavingAt(instant: Date, timeZone: string): boolean {
  const year = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(
      instant,
    ),
  );
  const january = localOffsetMs(new Date(Date.UTC(year, 0, 15, 12)), timeZone);
  const july = localOffsetMs(new Date(Date.UTC(year, 6, 15, 12)), timeZone);
  return localOffsetMs(instant, timeZone) === Math.max(january, july);
}
