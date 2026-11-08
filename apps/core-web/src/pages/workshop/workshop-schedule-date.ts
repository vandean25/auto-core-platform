import {
  addLocalDays,
  formatDateLabel,
  formatLocalDateInZone,
  formatTimeInZone,
  parseHhMm,
  zonedWallClockToUtc,
} from '@/lib/format'

const DATE_OPTION_DAYS = 14

export function workshopScheduleDateOptions(
  anchor: Date,
  timeZone: string,
  currentDate: string | null,
) {
  const start = formatLocalDateInZone(anchor, timeZone)
  const dates = new Set<string>()
  for (let offset = 0; offset < DATE_OPTION_DAYS; offset += 1) {
    dates.add(addLocalDays(start, offset))
  }
  if (currentDate) dates.add(currentDate)
  return [...dates].sort().map((date) => ({
    value: date,
    label: formatDateLabel(date, timeZone),
  }))
}

/** Moves a booked window onto another local day and keeps its duration. */
export function shiftScheduleToLocalDate(
  startIso: string,
  endIso: string,
  date: string,
  timeZone: string,
) {
  const startTime = formatTimeInZone(startIso, timeZone)
  if (!startTime) return null
  const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (durationMs <= 0) return null
  const { hour, minute } = parseHhMm(startTime)
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return null
  const start = zonedWallClockToUtc(timeZone, year, month, day, hour, minute)
  return {
    scheduledStartAt: start.toISOString(),
    scheduledEndAt: new Date(start.getTime() + durationMs).toISOString(),
  }
}
