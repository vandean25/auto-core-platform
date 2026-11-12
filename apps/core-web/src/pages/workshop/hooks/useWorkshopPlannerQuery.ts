import { useWorkshopPlanner, useWorkshopSettings } from '@/api/workshop'
import {
  buildPlannerDaySlots,
  buildPlannerPageSubtitle,
  buildPlannerWeekDates,
  computePlannerQueryRange,
  resolvePlannerDayHours,
  shouldShowPlannerClosedDay,
} from '@/features/workshop/planner/planner-page-layout'
import type { PlannerViewMode } from '@/components/workshop/planner/PlannerViewToggle'
import { usePlannerAnchorDate } from './usePlannerAnchorDate'

export function useWorkshopPlannerQuery(viewMode: PlannerViewMode) {
  const { data: settings } = useWorkshopSettings()
  const { anchorDate, shiftAnchor } = usePlannerAnchorDate(settings?.timezone)

  const timezone = settings?.timezone ?? 'Europe/Vienna'
  const { from, to, weekStart } = computePlannerQueryRange(viewMode, anchorDate, timezone)
  const { data: plannerData, isLoading } = useWorkshopPlanner(from, to)

  const plannerTimezone = plannerData?.timezone ?? timezone
  const slotMinutes = plannerData?.slotMinutes ?? 30
  const bays = plannerData?.bays ?? []
  const openings = plannerData?.openings ?? []
  const holidays = plannerData?.holidays ?? []
  const bookings = plannerData?.bookings ?? []
  const employeesAway = plannerData?.employeesAway ?? []

  const dayHours = resolvePlannerDayHours(viewMode, anchorDate, openings, holidays)

  return {
    anchorDate,
    shiftAnchor,
    isLoading,
    bays,
    openings,
    holidays,
    bookings,
    employeesAway,
    plannerTimezone,
    subtitle: buildPlannerPageSubtitle(viewMode, anchorDate, weekStart, plannerTimezone),
    weekDates: buildPlannerWeekDates(weekStart),
    daySlots: buildPlannerDaySlots(
      viewMode,
      dayHours,
      slotMinutes,
      plannerTimezone,
      anchorDate,
    ),
    dayHours,
    showClosedDay: shouldShowPlannerClosedDay(viewMode, dayHours, bays.length),
  }
}
