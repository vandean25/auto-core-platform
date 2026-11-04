import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { WorkshopCapacityOrder } from '@/api/workshop'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatChipTime, formatHours } from '@/features/workshop/capacity/capacity-format'

type CapacityOrderChipProps = {
  order: WorkshopCapacityOrder
  timezone: string
}

export function CapacityOrderChip({ order, timezone }: CapacityOrderChipProps) {
  const { t } = useTranslation('workshop')
  const startsAt = formatChipTime(order.scheduledStartAt, timezone)
  const title = startsAt
    ? t('capacity.chip.starts', { time: startsAt })
    : t('capacity.chip.onFloor')

  return (
    <Link
      to={`/workshop/orders/${order.orderId}`}
      title={title}
      className="flex flex-col gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm transition hover:border-muted-foreground/40 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate font-medium text-foreground">{order.orderNumber}</span>
      <span className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="truncate">{order.plate ?? t('capacity.chip.noPlate')}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatHours(order.plannedLaborHours)}
        </span>
      </span>
      <span>
        <StatusBadge status={order.status} className="whitespace-nowrap" />
      </span>
    </Link>
  )
}
