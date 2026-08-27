import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { components } from '@/api/generated/openapi'
import type { PlannerBooking } from '@/api/workshop'
import {
  getEffectiveHours,
  buildDayWindow,
  type EffectiveHours,
} from '@/features/workshop/planner/planner-hours'
import { formatDateLabel } from '@/features/workshop/planner/planner-time'
import { PlannerBookingBlock } from './PlannerBookingBlock'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

type PlannerWeekGridProps = {
  bays: Array<{ id: string; name: string }>
  dates: string[]
  timezone: string
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  bookings: PlannerBooking[]
  onDayClick: (bayId: string, date: string, startIso: string) => void
}

function WeekDayCell({
  bayId,
  date,
  timezone,
  startIso,
  hours,
  bookings,
  onDayClick,
}: {
  bayId: string
  date: string
  timezone: string
  startIso: string
  hours: EffectiveHours
  bookings: PlannerBooking[]
  onDayClick: (bayId: string, date: string, startIso: string) => void
}) {
  const droppableId = `planner-week-slot-${bayId}__${date}`
  const { isOver, setNodeRef } = useDroppable({ id: droppableId })
  const dayWindow = buildDayWindow(hours, timezone, date)
  const totalMs = dayWindow.end.getTime() - dayWindow.start.getTime()

  return (
    <div
      ref={setNodeRef}
      data-testid={droppableId}
      className={`relative min-h-24 border-r border-b border-slate-200 p-1 transition-colors ${
        isOver ? 'bg-slate-100' : hours.isClosed ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
      }`}
    >
      {hours.isClosed && (
        <p className="text-[10px] text-slate-400 px-1">
          {hours.holidayName ? `Closed — ${hours.holidayName}` : 'Closed'}
        </p>
      )}
      <button
        type="button"
        className="absolute inset-0 z-0"
        onClick={() => onDayClick(bayId, date, startIso)}
        aria-label="Book slot"
      />
      {bookings.map((booking) => {
        const start = new Date(booking.scheduledStartAt)
        const end = new Date(booking.scheduledEndAt)
        const left = ((start.getTime() - dayWindow.start.getTime()) / totalMs) * 100
        const width = ((end.getTime() - start.getTime()) / totalMs) * 100
        return (
          <PlannerBookingBlock
            key={booking.orderId}
            booking={booking}
            style={{
              left: `${left}%`,
              width: `${Math.max(width, 20)}%`,
            }}
          />
        )
      })}
    </div>
  )
}

export function PlannerWeekGrid({
  bays,
  dates,
  timezone,
  openings,
  holidays,
  bookings,
  onDayClick,
}: PlannerWeekGridProps) {
  const hoursByDate = React.useMemo(() => {
    const map = new Map<string, EffectiveHours>()
    for (const date of dates) {
      map.set(date, getEffectiveHours(date, openings, holidays))
    }
    return map
  }, [dates, openings, holidays])

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `140px repeat(${dates.length}, minmax(120px, 1fr))` }}
      >
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
          Bay
        </div>
        {dates.map((date) => (
          <div
            key={date}
            className="border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-medium text-slate-600"
          >
            {formatDateLabel(date, timezone)}
          </div>
        ))}

        {bays.map((bay) => (
          <React.Fragment key={bay.id}>
            <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
              {bay.name}
            </div>
            {dates.map((date) => {
              const hours = hoursByDate.get(date) ?? {
                isClosed: true,
                openTime: null,
                closeTime: null,
              }
              const dayWindow = buildDayWindow(hours, timezone, date)
              const dayBookings = bookings.filter(
                (booking) =>
                  booking.bayId === bay.id &&
                  new Date(booking.scheduledStartAt) < dayWindow.end &&
                  new Date(booking.scheduledEndAt) > dayWindow.start,
              )
              return (
                <WeekDayCell
                  key={`${bay.id}-${date}`}
                  bayId={bay.id}
                  date={date}
                  timezone={timezone}
                  startIso={dayWindow.start.toISOString()}
                  hours={hours}
                  bookings={dayBookings}
                  onDayClick={onDayClick}
                />
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export function parsePlannerWeekSlotId(id: string): { bayId: string; date: string } | null {
  const prefix = 'planner-week-slot-'
  if (!id.startsWith(prefix)) return null
  const remainder = id.slice(prefix.length)
  const [bayId, date] = remainder.split('__')
  if (!bayId || !date) return null
  return { bayId, date }
}
