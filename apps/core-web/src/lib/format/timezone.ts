import { formatToPartsInZone } from './intl-private'
import { parseIsoDateOnly } from './parse'

export function isoWeekdayFromDate(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

export function formatLocalDateInZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    formatToPartsInZone(date, timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function localOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    formatToPartsInZone(date, timeZone, {
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).map((part) => [part.type, part.value]),
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
  const firstOffsetMs = localOffsetMs(new Date(utcGuess), timeZone)
  let utcMillis = utcGuess - firstOffsetMs
  const secondOffsetMs = localOffsetMs(new Date(utcMillis), timeZone)
  if (secondOffsetMs !== firstOffsetMs) {
    utcMillis = utcGuess - secondOffsetMs
  }
  return new Date(utcMillis)
}

export function parseHhMm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number)
  return { hour, minute }
}

export function addLocalDays(isoDate: string, days: number): string {
  const { year, month, day } = parseIsoDateOnly(isoDate)
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

export function startOfWeekMonday(isoDate: string): string {
  const { year, month, day } = parseIsoDateOnly(isoDate)
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
  const fromParts = parseIsoDateOnly(fromIso)
  const toParts = parseIsoDateOnly(toExclusiveIso)
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

export function localWallClockOnDate(source: Date, targetDate: string, timeZone: string): Date {
  const parts = Object.fromEntries(
    formatToPartsInZone(source, timeZone, {
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).map((part) => [part.type, part.value]),
  )
  const { year, month, day } = parseIsoDateOnly(targetDate)
  return zonedWallClockToUtc(
    timeZone,
    year,
    month,
    day,
    Number(parts.hour),
    Number(parts.minute),
  )
}
