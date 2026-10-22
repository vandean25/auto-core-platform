import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import { mechanicTaskDetailQueryOptions, useMechanicQueue } from '@/api/mechanic'
import type { MechanicQueueItem } from '@/api/mechanic'
import { useHrMeClock, usePunchClock } from '@/api/hr'
import type { PunchClockPayload } from '@/api/hr'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'
import { MechanicQueueCard } from './MechanicQueueCard'

export default function MechanicQueuePage() {
  const { t } = useTranslation('workshop')
  const queryClient = useQueryClient()
  const { data: queueResponse, isLoading, error: queueError, refetch } = useMechanicQueue()
  const { data: clockResponse, error: clockError } = useHrMeClock()
  const { mutate: punchClock, isPending: isPunchPending } = usePunchClock()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!clockError || getErrorStatus(clockError) === 403) return

    toast.error(getErrorMessage(clockError, t('mechanic.queue.clockLoadError')))
  }, [clockError, t])

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

  const items = useMemo(() => {
    const queueItems = queueResponse?.data ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) return queueItems

    return queueItems.filter((item) => {
      const vehicle = `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`
      return [item.taskTitle, item.orderNumber, item.vehicle.plate ?? '', vehicle]
        .some((field) => field.toLowerCase().includes(needle))
    })
  }, [queueResponse, search])

  const prefetchTaskDetail = useCallback(
    (taskId: string) => {
      void queryClient.prefetchQuery(mechanicTaskDetailQueryOptions(taskId))
    },
    [queryClient],
  )

  const hasSearch = search.trim().length > 0
  const queueErrorStatus = queueError ? getErrorStatus(queueError) : null
  const hasIdentityError = queueErrorStatus === 404
  const hasQueueLoadError = queueError !== null && !hasIdentityError

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('mechanic.queue.title')}</h1>
          <p className="text-slate-500">{t('mechanic.queue.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {clockResponse && getErrorStatus(clockError) !== 403 ? (
            <AttendancePunchBar
              state={clockResponse.state}
              pending={isPunchPending}
              size="compact"
              touchFriendly
              onPunch={handlePunch}
            />
          ) : null}
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

      {isLoading ? <p className="text-slate-500">{t('mechanic.queue.loading')}</p> : null}
      {!isLoading && hasIdentityError ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-amber-950">{t('mechanic.queue.identityErrorTitle')}</h2>
          <p className="mt-1 text-amber-900">{t('mechanic.queue.identityErrorDescription')}</p>
        </div>
      ) : null}
      {!isLoading && hasQueueLoadError ? (
        <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-red-950">{t('mechanic.queue.loadErrorTitle')}</h2>
          <p className="mt-1 text-red-900">
            {getErrorMessage(queueError, t('mechanic.queue.loadErrorFallback'))}
          </p>
          <Button className="mt-4 min-h-11" variant="outline" onClick={() => void refetch()}>
            {t('mechanic.queue.tryAgain')}
          </Button>
        </div>
      ) : null}
      {!isLoading && !queueError && items.length === 0 && hasSearch ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-slate-500">{t('mechanic.queue.noResults')}</p>
        </div>
      ) : null}
      {!isLoading && !queueError && items.length === 0 && !hasSearch ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">{t('mechanic.queue.emptyTitle')}</h2>
          <p className="mt-1 text-slate-500">{t('mechanic.queue.emptyDescription')}</p>
        </div>
      ) : null}
      {!isLoading && !queueError && items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item: MechanicQueueItem) => (
            <MechanicQueueCard
              key={item.taskId}
              item={item}
              onPrefetch={() => prefetchTaskDetail(item.taskId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
