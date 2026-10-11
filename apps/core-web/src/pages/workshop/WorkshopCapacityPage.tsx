import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthSession } from '@/api/auth-session'
import { useWorkshopCapacityWeek } from '@/api/workshop'
import { useMySites, useSetActiveSite } from '@/api/sites'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CapacityWeekGrid } from '@/components/workshop/capacity/CapacityWeekGrid'
import { addLocalDays, formatDateLabel } from '@/features/workshop/planner/planner-time'

export default function WorkshopCapacityPage() {
  const navigate = useNavigate()
  const [anchorWeek, setAnchorWeek] = React.useState<string | undefined>(undefined)
  const capacity = useWorkshopCapacityWeek(anchorWeek)
  const session = useAuthSession()
  const sites = useMySites()
  const switchSite = useSetActiveSite()

  const week = capacity.data
  const shownWeekStart = anchorWeek ?? week?.weekStart
  const siteList = sites.data ?? []
  const activeSiteId = session.data?.activeSiteId ?? null
  const activeSite = siteList.find((site) => site.id === activeSiteId)

  const shiftWeek = (days: number) => {
    if (shownWeekStart) setAnchorWeek(addLocalDays(shownWeekStart, days))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workshop Capacity</h1>
          <p className="text-slate-500">
            Planned labour per bay and day, and the free hours left in each working day.
          </p>
        </div>
        {siteList.length > 1 ? (
          <Select
            value={activeSiteId ?? undefined}
            onValueChange={(siteId) => switchSite.mutate(siteId)}
            disabled={switchSite.isPending}
          >
            <SelectTrigger aria-label="Switch site" className="w-56">
              <SelectValue placeholder="Select site" />
            </SelectTrigger>
            <SelectContent>
              {siteList.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : activeSite ? (
          <p className="text-sm font-medium text-slate-700">{activeSite.name}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            disabled={!shownWeekStart}
            onClick={() => shiftWeek(-7)}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setAnchorWeek(undefined)}>
            This week
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            disabled={!shownWeekStart}
            onClick={() => shiftWeek(7)}
          >
            <ChevronRight />
          </Button>
          {shownWeekStart && week ? (
            <p className="ml-2 text-sm font-medium text-slate-700">
              {formatDateLabel(shownWeekStart, week.timezone)} –{' '}
              {formatDateLabel(addLocalDays(shownWeekStart, 5), week.timezone)}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Red cells are overbooked: planned labour is more than the bay&apos;s open hours.
        </p>
      </div>

      {capacity.isError && !week ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p>Could not load the capacity week.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => capacity.refetch()}>
            Try again
          </Button>
        </div>
      ) : !week ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : week.bays.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
          <p>No active bays for this site yet.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/settings?tab=bays')}>
            Add bays in Settings
          </Button>
        </div>
      ) : (
        <CapacityWeekGrid week={week} />
      )}
    </div>
  )
}
