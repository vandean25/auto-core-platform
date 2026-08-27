import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { PlannerBooking } from '@/api/workshop'
import type { EffectiveHours, PlannerSlot } from '@/features/workshop/planner/planner-hours'
import { buildDayWindow } from '@/features/workshop/planner/planner-hours'
import { PlannerBookingBlock } from './PlannerBookingBlock'

type PlannerDayGridProps = {
  bays: Array<{ id: string; name: string }>
  date: string
  timezone: string
  slots: PlannerSlot[]
  hours: EffectiveHours
  bookings: PlannerBooking[]
  onSlotClick: (bayId: string, startIso: string) => void
}

function slotDroppableId(bayId: string, startIso: string) {
  return `planner-slot-${bayId}__${startIso}`
}

function DroppableSlot({
  bayId,
  slot,
  onSlotClick,
}: {
  bayId: string
  slot: PlannerSlot
  onSlotClick: (bayId: string, startIso: string) => void
}) {
  const startIso = slot.start.toISOString()
  const droppableId = slotDroppableId(bayId, startIso)
  const { isOver, setNodeRef } = useDroppable({ id: droppableId })

  return (
    <button
      type="button"
      ref={setNodeRef}
      data-testid={droppableId}
      className={`h-full min-h-10 border-r border-slate-100 transition-colors ${
        isOver ? 'bg-slate-200' : 'bg-white hover:bg-slate-50'
      }`}
      onClick={() => onSlotClick(bayId, startIso)}
      aria-label={`Book ${slot.label}`}
    />
  )
}

export function PlannerDayGrid({
  bays,
  date,
  timezone,
  slots,
  hours,
  bookings,
  onSlotClick,
}: PlannerDayGridProps) {
  const dayWindow = buildDayWindow(hours, timezone, date)
  const totalMs = dayWindow.end.getTime() - dayWindow.start.getTime()

  const bookingsByBay = React.useMemo(() => {
    const map = new Map<string, PlannerBooking[]>()
    for (const bay of bays) {
      map.set(
        bay.id,
        bookings.filter((booking) => booking.bayId === bay.id),
      )
    }
    return map
  }, [bays, bookings])

  if (slots.length === 0) {
    return (
      <div className="space-y-3">
        {bays.map((bay) => {
          const bayBookings = bookingsByBay.get(bay.id) ?? []
          return (
            <div key={bay.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-700 mb-2">{bay.name}</p>
              <div className="relative h-16 rounded-md bg-white border border-dashed border-slate-200">
                {bayBookings.map((booking) => {
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
                        width: `${Math.max(width, 4)}%`,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `140px repeat(${slots.length}, minmax(48px, 1fr))` }}
      >
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
          Bay
        </div>
        {slots.map((slot) => (
          <div
            key={slot.start.toISOString()}
            className="border-b border-l border-slate-200 bg-slate-50 px-1 py-2 text-center text-xs font-medium text-slate-500"
          >
            {slot.label}
          </div>
        ))}

        {bays.map((bay) => {
          const bayBookings = bookingsByBay.get(bay.id) ?? []
          return (
            <React.Fragment key={bay.id}>
              <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                {bay.name}
              </div>
              <div
                className="relative border-b border-slate-200"
                style={{
                  gridColumn: `2 / span ${slots.length}`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${slots.length}, minmax(48px, 1fr))`,
                }}
              >
                {slots.map((slot) => (
                  <DroppableSlot
                    key={`${bay.id}-${slot.start.toISOString()}`}
                    bayId={bay.id}
                    slot={slot}
                    onSlotClick={onSlotClick}
                  />
                ))}
                <div className="pointer-events-none absolute inset-0">
                  {bayBookings.map((booking) => {
                    const start = new Date(booking.scheduledStartAt)
                    const end = new Date(booking.scheduledEndAt)
                    const left = ((start.getTime() - dayWindow.start.getTime()) / totalMs) * 100
                    const width = ((end.getTime() - start.getTime()) / totalMs) * 100
                    return (
                      <div
                        key={booking.orderId}
                        className="pointer-events-auto absolute inset-y-1"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 4)}%`,
                        }}
                      >
                        <PlannerBookingBlock booking={booking} />
                      </div>
                    )
                  })}
                </div>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

export function parsePlannerSlotId(id: string): { bayId: string; startIso: string } | null {
  const prefix = 'planner-slot-'
  if (!id.startsWith(prefix)) return null
  const remainder = id.slice(prefix.length)
  const separator = remainder.indexOf('__')
  if (separator <= 0) return null
  return {
    bayId: remainder.slice(0, separator),
    startIso: remainder.slice(separator + 2),
  }
}
