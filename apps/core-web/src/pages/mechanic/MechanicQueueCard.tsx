import { formatDateShort } from '@/lib/format'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Card } from '@/components/ui/card'
import type { MechanicQueueItem } from '@/api/mechanic'

interface MechanicQueueCardProps {
  item: MechanicQueueItem
  onPrefetch?: () => void
}

function formatVehicle(item: MechanicQueueItem) {
  return `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`
}

export function MechanicQueueCard({ item, onPrefetch }: MechanicQueueCardProps) {
  const { t } = useTranslation('workshop')
  return (
    <Link
      to={`/mechanic/tasks/${item.taskId}`}
      className="block min-h-11 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return
        onPrefetch?.()
      }}
      onFocus={onPrefetch}
    >
      <Card className="min-h-[72px] p-4 transition-colors hover:bg-slate-50">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.sequence > 0 ? (
                <span className="font-mono text-sm font-semibold text-slate-500">
                  {t('mechanic.queue.taskSequence', { sequence: item.sequence })}
                </span>
              ) : null}
              <h2 className="truncate font-semibold text-slate-900">{item.taskTitle}</h2>
              <StatusBadge status={item.taskStatus} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>{item.orderNumber}</span>
              <span>{item.vehicle.plate ?? t('mechanic.queue.noPlate')}</span>
              <span>{formatVehicle(item)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 md:shrink-0 md:justify-end">
            {item.bay ? <span>{t('mechanic.queue.bay', { name: item.bay.name })}</span> : null}
            {item.scheduledDate ? (
              <span>
                {t('mechanic.queue.scheduled', { date: formatDateShort(item.scheduledDate) })}
              </span>
            ) : null}
          </div>
        </div>
      </Card>
    </Link>
  )
}
