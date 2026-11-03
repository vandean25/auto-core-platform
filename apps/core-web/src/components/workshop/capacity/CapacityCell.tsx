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
          ? 'border-destructive/40 bg-destructive/10'
          : isClosed
            ? 'border-border bg-muted/50'
            : 'border-border bg-card',
      )}
    >
      <p
        className={cn(
          'text-xs font-medium',
          cell.isOverbooked ? 'text-destructive' : 'text-muted-foreground',
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
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className={cn('h-full rounded-full', cell.isOverbooked ? 'bg-destructive' : 'bg-success')}
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
