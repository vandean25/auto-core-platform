import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import { useMechanicQueue } from '@/api/mechanic'
import type { MechanicQueueItem } from '@/api/mechanic'
import { useHrMeClock, usePunchClock } from '@/api/hr'
import type { PunchClockPayload } from '@/api/hr'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'
import { MechanicQueueCard } from './MechanicQueueCard'

export default function MechanicQueuePage() {
  const { data: queueResponse, isLoading, error: queueError, refetch } = useMechanicQueue()
  const { data: clockResponse, error: clockError } = useHrMeClock()
  const { mutate: punchClock, isPending: isPunchPending } = usePunchClock()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!clockError || getErrorStatus(clockError) === 403) return

    toast.error(getErrorMessage(clockError, 'Failed to load attendance clock'))
  }, [clockError])

  const handlePunch = (type: PunchClockPayload['type']) => {
    punchClock(
      { type },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error, 'Failed to punch attendance clock'))
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

  const hasSearch = search.trim().length > 0
  const queueErrorStatus = queueError ? getErrorStatus(queueError) : null
  const hasIdentityError = queueErrorStatus === 404
  const hasQueueLoadError = queueError !== null && !hasIdentityError

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Queue</h1>
          <p className="text-slate-500">Your active work orders — tap a task to open it.</p>
        </div>
        <div className="flex items-center gap-2">
          {clockResponse && getErrorStatus(clockError) !== 403 ? (
            <AttendancePunchBar
              state={clockResponse.state}
              pending={isPunchPending}
              size="compact"
              onPunch={handlePunch}
            />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            aria-label="Refresh queue"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search tasks, plates, WO…"
        aria-label="Search mechanic queue"
      />

      {isLoading ? <p className="text-slate-500">Loading tasks…</p> : null}
      {!isLoading && hasIdentityError ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-amber-950">Mechanic profile not linked</h2>
          <p className="mt-1 text-amber-900">
            Your login is not linked to an active mechanic employee in this tenant. Ask an admin to
            link your HR employee record, or re-run the UAT tenant-member seed for this account.
          </p>
        </div>
      ) : null}
      {!isLoading && hasQueueLoadError ? (
        <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-red-950">Could not load your queue</h2>
          <p className="mt-1 text-red-900">
            {getErrorMessage(queueError, 'Failed to load mechanic queue')}
          </p>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {!isLoading && !queueError && items.length === 0 && hasSearch ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-slate-500">No results.</p>
        </div>
      ) : null}
      {!isLoading && !queueError && items.length === 0 && !hasSearch ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">No tasks assigned</h2>
          <p className="mt-1 text-slate-500">Jobs you are assigned appear here.</p>
        </div>
      ) : null}
      {!isLoading && !queueError && items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item: MechanicQueueItem) => (
            <MechanicQueueCard key={item.taskId} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
