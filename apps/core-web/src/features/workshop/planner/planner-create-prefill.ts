import type { PlannerCreatePrefill } from '@/components/workshop/planner/PlannerCreateSheet'
import { buildDayWindow, getEffectiveHours, type EffectiveHours } from './planner-hours'
import { formatLocalDate } from './planner-time'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

const DEFAULT_CREATE_DURATION_MS = 60 * 60 * 1000

export function defaultCreateEndTime(start: Date, explicitEndIso?: string): Date {
  if (explicitEndIso) {
    return new Date(explicitEndIso)
  }
  return new Date(start.getTime() + DEFAULT_CREATE_DURATION_MS)
}

export function clampEndToDayWindow(
  end: Date,
  hours: EffectiveHours,
  timezone: string,
  date: string,
): Date {
  if (!hours.closeTime || !hours.openTime || hours.isClosed) {
    return end
  }
  const window = buildDayWindow(hours, timezone, date)
  if (end > window.end) {
    return window.end
  }
  return end
}

export function buildPlannerCreatePrefill(params: {
  bayId: string
  startIso: string
  endIso?: string
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  timezone: string
}): PlannerCreatePrefill {
  const start = new Date(params.startIso)
  const startDate = formatLocalDate(start, params.timezone)
  const hours = getEffectiveHours(startDate, params.openings, params.holidays)
  const rawEnd = defaultCreateEndTime(start, params.endIso)
  const end = clampEndToDayWindow(rawEnd, hours, params.timezone, startDate)
  return {
    bayId: params.bayId,
    scheduledStartAt: start.toISOString(),
    scheduledEndAt: end.toISOString(),
  }
}
