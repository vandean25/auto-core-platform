import type { PlannerViewMode } from '@/components/workshop/planner/PlannerViewToggle'
import {
  buildSlots,
  getEffectiveHours,
  type EffectiveHours,
  type PlannerSlot,
} from './planner-hours'
import {
  addLocalDays,
  eachLocalDateInRange,
  formatDateLabel,
  localDateRangeToUtc,
  startOfWeekMonday,
} from './planner-time'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

export function computePlannerWeekStart(anchorDate: string): string {
  return startOfWeekMonday(anchorDate)
}

export function computePlannerQueryRange(
  viewMode: PlannerViewMode,
  anchorDate: string,
  timezone: string,
): { from: string; to: string; rangeFromDate: string; rangeToDate: string; weekStart: string } {
  const weekStart = computePlannerWeekStart(anchorDate)
  const rangeFromDate = viewMode === 'day' ? anchorDate : weekStart
  const rangeToDate =
    viewMode === 'day' ? addLocalDays(anchorDate, 1) : addLocalDays(weekStart, 7)
  const queryRange = localDateRangeToUtc(rangeFromDate, rangeToDate, timezone)
  return {
    from: queryRange.from,
    to: queryRange.to,
    rangeFromDate,
    rangeToDate,
    weekStart,
  }
}

export function buildPlannerPageSubtitle(
  viewMode: PlannerViewMode,
  anchorDate: string,
  weekStart: string,
  plannerTimezone: string,
): string {
  if (viewMode === 'day') {
    return formatDateLabel(anchorDate, plannerTimezone)
  }
  return `${formatDateLabel(weekStart, plannerTimezone)} – ${formatDateLabel(
    addLocalDays(weekStart, 6),
    plannerTimezone,
  )}`
}

export function buildPlannerWeekDates(weekStart: string): string[] {
  return eachLocalDateInRange(weekStart, addLocalDays(weekStart, 7))
}

export function resolvePlannerDayHours(
  viewMode: PlannerViewMode,
  anchorDate: string,
  openings: WorkshopOpeningHour[],
  holidays: PlannerHoliday[],
): EffectiveHours | null {
  if (viewMode !== 'day') return null
  return getEffectiveHours(anchorDate, openings, holidays)
}

export function buildPlannerDaySlots(
  viewMode: PlannerViewMode,
  dayHours: EffectiveHours | null,
  slotMinutes: number,
  plannerTimezone: string,
  anchorDate: string,
): PlannerSlot[] {
  if (viewMode !== 'day' || !dayHours) return []
  return buildSlots(dayHours, slotMinutes, plannerTimezone, anchorDate)
}

export function shouldShowPlannerClosedDay(
  viewMode: PlannerViewMode,
  dayHours: EffectiveHours | null,
  bayCount: number,
): boolean {
  return (
    viewMode === 'day' &&
    !!dayHours &&
    dayHours.isClosed &&
    bayCount > 0
  )
}

export function plannerAnchorShiftDays(viewMode: PlannerViewMode, direction: -1 | 1): number {
  if (viewMode === 'day') return direction
  return direction * 7
}
