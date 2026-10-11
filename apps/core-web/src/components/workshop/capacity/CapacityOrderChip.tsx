import { Link } from 'react-router-dom'
import type { WorkshopCapacityOrder } from '@/api/workshop'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatChipTime, formatHours } from '@/features/workshop/capacity/capacity-format'

type CapacityOrderChipProps = {
  order: WorkshopCapacityOrder
  timezone: string
}

export function CapacityOrderChip({ order, timezone }: CapacityOrderChipProps) {
  const startsAt = formatChipTime(order.scheduledStartAt, timezone)
  const title = startsAt ? `Starts ${startsAt}` : 'Already on the floor'

  return (
    <Link
      to={`/workshop/orders/${order.orderId}`}
      title={title}
      className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs shadow-sm transition hover:border-slate-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <span className="truncate font-medium text-slate-900">{order.orderNumber}</span>
      <span className="flex items-center justify-between gap-2 text-slate-600">
        <span className="truncate">{order.plate ?? 'No plate'}</span>
        <span className="shrink-0 tabular-nums text-slate-500">
          {formatHours(order.plannedLaborHours)}
        </span>
      </span>
      <span>
        <StatusBadge status={order.status} className="whitespace-nowrap" />
      </span>
    </Link>
  )
}
