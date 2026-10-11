import type { WorkshopCapacityCell } from '@/api/workshop'
import { cn } from '@/lib/utils'
import { describeCellHours, formatHours } from '@/features/workshop/capacity/capacity-format'
import { CapacityOrderChip } from './CapacityOrderChip'

type CapacityCellProps = {
  cell: WorkshopCapacityCell
  bayName: string
  timezone: string
}

export function CapacityCell({ cell, bayName, timezone }: CapacityCellProps) {
  const isClosed = cell.capacityHours === 0 && cell.bookedHours === 0
  const fillPercent =
    cell.capacityHours > 0 ? Math.min(100, (cell.bookedHours / cell.capacityHours) * 100) : 0

  return (
    <div
      data-overbooked={cell.isOverbooked ? 'true' : 'false'}
      className={cn(
        'flex h-full min-h-28 flex-col gap-2 rounded-md border p-1.5',
        cell.isOverbooked
          ? 'border-red-300 bg-red-50'
          : isClosed
            ? 'border-slate-200 bg-slate-50'
            : 'border-slate-200 bg-white',
      )}
    >
      <p
        className={cn(
          'text-xs font-medium',
          cell.isOverbooked ? 'text-red-700' : 'text-slate-600',
        )}
      >
        {describeCellHours(cell)}
      </p>
      {cell.capacityHours > 0 ? (
        <div
          role="meter"
          aria-label={`${bayName} booked hours`}
          aria-valuemin={0}
          aria-valuemax={cell.capacityHours}
          aria-valuenow={cell.bookedHours}
          aria-valuetext={`${formatHours(cell.bookedHours)} of ${formatHours(cell.capacityHours)}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        >
          <div
            className={cn('h-full rounded-full', cell.isOverbooked ? 'bg-red-500' : 'bg-emerald-500')}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      ) : null}
      {cell.orders.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {cell.orders.map((order) => (
            <li key={order.orderId}>
              <CapacityOrderChip order={order} timezone={timezone} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
