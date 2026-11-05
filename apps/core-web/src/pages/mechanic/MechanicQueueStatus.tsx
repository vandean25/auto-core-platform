import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { MechanicQueueItem } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { MechanicQueueCard } from './MechanicQueueCard'
import type { MechanicQueueView } from './mechanic-queue-view'

type MechanicQueueStatusProps = {
  view: MechanicQueueView
  queueError: unknown | null
  items: MechanicQueueItem[]
  onRetry: () => void
  onPrefetch: (taskId: string) => void
}

export function MechanicQueueStatus({
  view,
  queueError,
  items,
  onRetry,
  onPrefetch,
}: MechanicQueueStatusProps) {
  const { t } = useTranslation('workshop')

  switch (view) {
    case 'loading':
      return <p className="text-muted-foreground">{t('mechanic.queue.loading')}</p>
    case 'identity-error':
      return (
        <div className="rounded-xl border border-dashed border-warning/30 bg-warning/10 p-8 text-center">
          <h2 className="text-lg font-semibold text-warning">{t('mechanic.queue.identityErrorTitle')}</h2>
          <p className="mt-1 text-warning">{t('mechanic.queue.identityErrorDescription')}</p>
        </div>
      )
    case 'load-error':
      return (
        <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/10 p-8 text-center">
          <h2 className="text-lg font-semibold text-destructive">{t('mechanic.queue.loadErrorTitle')}</h2>
          <p className="mt-1 text-destructive">
            {getErrorMessage(queueError, t('mechanic.queue.loadErrorFallback'))}
          </p>
          <Button className="mt-4 min-h-11" variant="outline" onClick={onRetry}>
            {t('mechanic.queue.tryAgain')}
          </Button>
        </div>
      )
    case 'no-results':
      return (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">{t('mechanic.queue.noResults')}</p>
        </div>
      )
    case 'empty':
      return (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">{t('mechanic.queue.emptyTitle')}</h2>
          <p className="mt-1 text-muted-foreground">{t('mechanic.queue.emptyDescription')}</p>
        </div>
      )
    case 'list':
      return (
        <div className="space-y-3">
          {items.map((item) => (
            <MechanicQueueCard
              key={item.taskId}
              item={item}
              onPrefetch={() => onPrefetch(item.taskId)}
            />
          ))}
        </div>
      )
    default:
      return null
  }
}
