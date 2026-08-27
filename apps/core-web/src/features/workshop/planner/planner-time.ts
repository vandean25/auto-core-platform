export function isoWeekdayFromDate(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
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
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function parseLocalDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
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
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

export function zonedWallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetMs = localOffsetMs(new Date(utcGuess), timeZone)
  return new Date(utcGuess - offsetMs)
}

export function parseHhMm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number)
  return { hour, minute }
}

export function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function formatDateLabel(date: string, timeZone: string): string {
  const { year, month, day } = parseLocalDate(date)
  const utc = Date.UTC(year, month - 1, day, 12, 0, 0)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(utc))
}

export function addLocalDays(isoDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(isoDate)
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

export function startOfWeekMonday(isoDate: string): string {
  const { year, month, day } = parseLocalDate(isoDate)
  const weekday = isoWeekdayFromDate(year, month, day)
  return addLocalDays(isoDate, -(weekday - 1))
}

export function eachLocalDateInRange(fromIso: string, toExclusiveIso: string): string[] {
  const dates: string[] = []
  let cursor = fromIso
  while (cursor < toExclusiveIso) {
    dates.push(cursor)
    cursor = addLocalDays(cursor, 1)
  }
  return dates
}

export function localDateRangeToUtc(
  fromIso: string,
  toExclusiveIso: string,
  timeZone: string,
): { from: string; to: string } {
  const fromParts = parseLocalDate(fromIso)
  const toParts = parseLocalDate(toExclusiveIso)
  const from = zonedWallClockToUtc(
    timeZone,
    fromParts.year,
    fromParts.month,
    fromParts.day,
    0,
    0,
  )
  const to = zonedWallClockToUtc(timeZone, toParts.year, toParts.month, toParts.day, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}
