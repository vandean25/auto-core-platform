import * as React from 'react'
import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { PlannerBooking } from '@/api/workshop'
import { resolvePlannerDragReschedule } from '@/features/workshop/planner/planner-drag-reschedule'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

export function usePlannerDragAndDrop(params: {
  bookings: PlannerBooking[]
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  plannerTimezone: string
  performReschedule: (orderId: string, bayId: string, startIso: string, durationMs: number) => void
}) {
  const [activeBookingId, setActiveBookingId] = React.useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor))

  const activeBooking = activeBookingId
    ? params.bookings.find((booking) => booking.orderId === activeBookingId) ?? null
    : null

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveBookingId(String(event.active.id))
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveBookingId(null)
      const { active, over } = event
      if (!over) return

      const booking = params.bookings.find((row) => row.orderId === String(active.id))
      const request = booking
        ? resolvePlannerDragReschedule(
            booking,
            String(over.id),
            params.openings,
            params.holidays,
            params.plannerTimezone,
          )
        : null
      if (!request) return

      params.performReschedule(request.orderId, request.bayId, request.startIso, request.durationMs)
    },
    [params],
  )

  return { sensors, activeBooking, handleDragStart, handleDragEnd }
}
