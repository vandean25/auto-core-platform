import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { mechanicTaskDetailQueryOptions, useMechanicQueue } from '@/api/mechanic'
import { useHrMeClock, usePunchClock } from '@/api/hr'
import type { PunchClockPayload } from '@/api/hr'
import { getErrorMessage } from '@/lib/error-utils'
import { filterMechanicQueue, getMechanicQueueView } from './mechanic-queue-view'
import { MechanicQueuePunch } from './MechanicQueuePunch'
import { MechanicQueueStatus } from './MechanicQueueStatus'
import { useClockErrorToast } from './useClockErrorToast'

export default function MechanicQueuePage() {
  const { t } = useTranslation('workshop')
  const queryClient = useQueryClient()
  const { data: queueResponse, isLoading, error: queueError, refetch } = useMechanicQueue()
  const { data: clockResponse, error: clockError } = useHrMeClock()
  const { mutate: punchClock, isPending: isPunchPending } = usePunchClock()
  const [search, setSearch] = useState('')

  useClockErrorToast(clockError)

  const handlePunch = (type: PunchClockPayload['type']) => {
    punchClock(
      { type },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error, t('mechanic.queue.punchError')))
        },
      },
    )
  }

  const items = useMemo(
    () => filterMechanicQueue(queueResponse?.data ?? [], search),
    [queueResponse, search],
  )

  const prefetchTaskDetail = useCallback(
    (taskId: string) => {
      void queryClient.prefetchQuery(mechanicTaskDetailQueryOptions(taskId))
    },
    [queryClient],
  )

  const hasSearch = search.trim().length > 0
  const view = getMechanicQueueView({
    isLoading,
    queueError,
    itemCount: items.length,
    hasSearch,
  })

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('mechanic.queue.title')}</h1>
          <p className="text-slate-500">{t('mechanic.queue.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MechanicQueuePunch
            clockResponse={clockResponse}
            clockError={clockError}
            isPunchPending={isPunchPending}
            onPunch={handlePunch}
          />
          <Button
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={() => void refetch()}
            aria-label={t('mechanic.queue.refreshAria')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Input
        type="search"
        className="min-h-11"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('mechanic.queue.searchPlaceholder')}
        aria-label={t('mechanic.queue.searchAria')}
      />

      <MechanicQueueStatus
        view={view}
        queueError={queueError}
        items={items}
        onRetry={() => void refetch()}
        onPrefetch={prefetchTaskDetail}
      />
    </div>
  )
}
