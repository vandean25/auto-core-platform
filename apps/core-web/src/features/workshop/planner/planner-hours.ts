import type { components } from '@/api/generated/openapi'
import {
  isoWeekdayFromDate,
  parseHhMm,
  parseLocalDate,
  zonedWallClockToUtc,
} from './planner-time'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

export type EffectiveHours = {
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
  holidayName?: string
}

export function getEffectiveHours(
  date: string,
  openings: WorkshopOpeningHour[],
  holidays: PlannerHoliday[],
): EffectiveHours {
  const holiday = holidays.find((row) => row.date === date)
  if (holiday) {
    return {
      isClosed: holiday.isClosed,
      openTime: holiday.openTime ?? null,
      closeTime: holiday.closeTime ?? null,
      holidayName: holiday.name,
    }
  }

  const { year, month, day } = parseLocalDate(date)
  const weekday = isoWeekdayFromDate(year, month, day)
  const opening = openings.find((row) => row.weekday === weekday)
  return {
    isClosed: opening?.isClosed ?? true,
    openTime: opening?.openTime ?? null,
    closeTime: opening?.closeTime ?? null,
  }
}

export type PlannerSlot = {
  start: Date
  end: Date
  label: string
}

export function buildDayWindow(
  hours: EffectiveHours,
  timezone: string,
  date: string,
): { start: Date; end: Date } {
  const { year, month, day } = parseLocalDate(date)
  if (hours.isClosed || !hours.openTime || !hours.closeTime) {
    return {
      start: zonedWallClockToUtc(timezone, year, month, day, 0, 0),
      end: zonedWallClockToUtc(timezone, year, month, day + 1, 0, 0),
    }
  }
  const open = parseHhMm(hours.openTime)
  const close = parseHhMm(hours.closeTime)
  return {
    start: zonedWallClockToUtc(timezone, year, month, day, open.hour, open.minute),
    end: zonedWallClockToUtc(timezone, year, month, day, close.hour, close.minute),
  }
}

export function buildSlots(
  hours: EffectiveHours,
  slotMinutes: number,
  timezone: string,
  date: string,
): PlannerSlot[] {
  if (hours.isClosed || !hours.openTime || !hours.closeTime) {
    return []
  }

  const window = buildDayWindow(hours, timezone, date)
  const slots: PlannerSlot[] = []
  let cursor = window.start
  const slotMs = slotMinutes * 60 * 1000

  while (cursor < window.end) {
    const next = new Date(cursor.getTime() + slotMs)
    const slotEnd = next > window.end ? window.end : next
    slots.push({
      start: cursor,
      end: slotEnd,
      label: new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(cursor),
    })
    cursor = next
  }

  return slots
}

export function intervalsOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): boolean {
  return leftStart < rightEnd && leftEnd > rightStart
}

export function isOutsideEffectiveHours(
  start: Date,
  end: Date,
  hours: EffectiveHours,
  timezone: string,
  date: string,
): boolean {
  if (hours.isClosed) {
    return true
  }
  if (!hours.openTime || !hours.closeTime) {
    return true
  }
  const window = buildDayWindow(hours, timezone, date)
  return start < window.start || end > window.end
}
