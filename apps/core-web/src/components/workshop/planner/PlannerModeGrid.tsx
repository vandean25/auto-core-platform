import type { PlannerBooking } from '@/api/workshop'
import type { PlannerViewMode } from './PlannerViewToggle'
import { PlannerDayGrid } from './PlannerDayGrid'
import { PlannerWeekGrid } from './PlannerWeekGrid'
import type { EffectiveHours, PlannerSlot } from '@/features/workshop/planner/planner-hours'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

export function PlannerModeGrid({
  viewMode,
  bays,
  anchorDate,
  plannerTimezone,
  daySlots,
  dayHours,
  weekDates,
  openings,
  holidays,
  bookings,
  onDaySlotClick,
  onWeekDayClick,
}: {
  viewMode: PlannerViewMode
  bays: Array<{ id: string; name: string }>
  anchorDate: string
  plannerTimezone: string
  daySlots: PlannerSlot[]
  dayHours: EffectiveHours | null
  weekDates: string[]
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  bookings: PlannerBooking[]
  onDaySlotClick: (bayId: string, startIso: string) => void
  onWeekDayClick: (bayId: string, date: string, startIso: string) => void
}) {
  if (viewMode === 'day') {
    return (
      <PlannerDayGrid
        bays={bays}
        date={anchorDate}
        timezone={plannerTimezone}
        slots={daySlots}
        hours={dayHours ?? { isClosed: true, openTime: null, closeTime: null }}
        bookings={bookings}
        onSlotClick={onDaySlotClick}
      />
    )
  }

  return (
    <PlannerWeekGrid
      bays={bays}
      dates={weekDates}
      timezone={plannerTimezone}
      openings={openings}
      holidays={holidays}
      bookings={bookings}
      onDayClick={onWeekDayClick}
    />
  )
}
