import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import type { PlannerBooking } from '@/api/workshop'
import { StatusBadge } from '@/components/status/StatusBadge'

interface PlannerBookingBlockProps {
  booking: PlannerBooking
  style?: React.CSSProperties
  isDragging?: boolean
}

export function PlannerBookingBlock({
  booking,
  style,
  isDragging = false,
}: PlannerBookingBlockProps) {
  const navigate = useNavigate()
  const isDraggable = booking.status === 'SCHEDULED' && booking.occupancyKind === 'BOOKING'

  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: booking.orderId,
    disabled: !isDraggable,
  })

  const dragStyle = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  const plate = booking.vehicle.plate ?? `${booking.vehicle.make} ${booking.vehicle.model}`

  const openOrder = () => navigate(`/workshop/orders/${booking.orderId}`)

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ ...style, ...dragStyle }}
      data-testid={`planner-booking-${booking.orderId}`}
      className={`absolute top-1 bottom-1 rounded-md border px-2 py-1 text-xs shadow-sm overflow-hidden text-left ${
        isDragging ? 'opacity-60 z-20' : 'z-10'
      } ${
        booking.occupancyKind === 'UNSCHEDULED_ON_FLOOR'
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-slate-300 bg-white text-slate-800'
      } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      onClick={openOrder}
      {...(isDraggable ? { ...listeners, ...attributes } : {})}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusBadge status={booking.status} />
        <span className="font-medium truncate">{booking.orderNumber}</span>
      </div>
      <p className="truncate text-slate-600">{plate}</p>
      {booking.mechanicName && (
        <p className="truncate text-slate-500">{booking.mechanicName}</p>
      )}
    </button>
  )
}
