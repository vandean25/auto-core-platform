import type { PlannerBooking } from '@/api/workshop'
import { buildDayWindow, getEffectiveHours, type EffectiveHours } from './planner-hours'
import { localWallClockOnDate } from './planner-time'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

export type PlannerRescheduleRequest = {
  orderId: string
  bayId: string
  startIso: string
  durationMs: number
}

export function plannerBookingDurationMs(booking: PlannerBooking): number {
  return (
    new Date(booking.scheduledEndAt).getTime() - new Date(booking.scheduledStartAt).getTime()
  )
}

export function isPlannerDragReschedulable(booking: PlannerBooking | undefined): booking is PlannerBooking {
  return !!booking && booking.status === 'SCHEDULED'
}

export function buildDaySlotReschedule(
  booking: PlannerBooking,
  bayId: string,
  startIso: string,
): PlannerRescheduleRequest {
  return {
    orderId: booking.orderId,
    bayId,
    startIso,
    durationMs: plannerBookingDurationMs(booking),
  }
}

export function resolveWeekSlotStartIso(
  booking: PlannerBooking,
  weekDate: string,
  hours: EffectiveHours,
  timezone: string,
): string {
  if (hours.isClosed || !hours.openTime || !hours.closeTime) {
    return buildDayWindow(hours, timezone, weekDate).start.toISOString()
  }
  const preservedStart = localWallClockOnDate(
    new Date(booking.scheduledStartAt),
    weekDate,
    timezone,
  )
  return preservedStart.toISOString()
}

export function resolvePlannerDragReschedule(
  booking: PlannerBooking,
  overId: string,
  openings: WorkshopOpeningHour[],
  holidays: PlannerHoliday[],
  timezone: string,
): PlannerRescheduleRequest | null {
  if (!isPlannerDragReschedulable(booking)) return null

  const slotMatch = overId.match(/^planner-slot-(.+)__(.+)$/)
  if (slotMatch) {
    const [, bayId, startIso] = slotMatch
    if (bayId && startIso) {
      return buildDaySlotReschedule(booking, bayId, startIso)
    }
  }

  const weekMatch = overId.match(/^planner-week-slot-(.+)__(\d{4}-\d{2}-\d{2})$/)
  if (weekMatch) {
    const [, bayId, date] = weekMatch
    if (bayId && date) {
      return buildWeekSlotReschedule(booking, bayId, date, openings, holidays, timezone)
    }
  }

  return null
}

export function buildWeekSlotReschedule(
  booking: PlannerBooking,
  bayId: string,
  weekDate: string,
  openings: WorkshopOpeningHour[],
  holidays: PlannerHoliday[],
  timezone: string,
): PlannerRescheduleRequest {
  const hours = getEffectiveHours(weekDate, openings, holidays)
  const startIso = resolveWeekSlotStartIso(booking, weekDate, hours, timezone)
  return {
    orderId: booking.orderId,
    bayId,
    startIso,
    durationMs: plannerBookingDurationMs(booking),
  }
}
