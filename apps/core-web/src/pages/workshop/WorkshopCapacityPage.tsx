import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthSession } from '@/api/auth-session'
import { useWorkshopCapacityWeek } from '@/api/workshop'
import { useMySites, useSetActiveSite } from '@/api/sites'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription } from '@/components/ui/empty'
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
  const { t } = useTranslation('workshop')
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
      <PageHeader
        className="mb-0"
        title={t('capacity.page.title')}
        description={t('capacity.page.description')}
        actions={
          siteList.length > 1 ? (
            <Select
              value={activeSiteId ?? undefined}
              onValueChange={(siteId) => switchSite.mutate(siteId)}
              disabled={switchSite.isPending}
            >
              <SelectTrigger aria-label={t('capacity.page.switchSite')} className="w-56 max-md:min-h-11">
                <SelectValue placeholder={t('capacity.page.selectSite')} />
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
            <p className="text-sm font-medium text-foreground">{activeSite.name}</p>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('capacity.page.previousWeek')}
            disabled={!shownWeekStart}
            onClick={() => shiftWeek(-7)}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setAnchorWeek(undefined)}>
            {t('capacity.page.thisWeek')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('capacity.page.nextWeek')}
            disabled={!shownWeekStart}
            onClick={() => shiftWeek(7)}
          >
            <ChevronRight />
          </Button>
          {week ? (
            <p className="ml-2 text-sm font-medium text-foreground">
              {formatDateLabel(week.weekStart, week.timezone)} –{' '}
              {formatDateLabel(addLocalDays(week.weekStart, 5), week.timezone)}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('capacity.page.overbookedHint')}</p>
      </div>

      {capacity.isError && !week ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          <p>{t('capacity.page.loadError')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => capacity.refetch()}>
            {t('capacity.page.tryAgain')}
          </Button>
        </div>
      ) : !week ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : week.bays.length === 0 ? (
        <Empty className="rounded-xl border">
          <EmptyDescription>{t('capacity.page.noBays')}</EmptyDescription>
          <EmptyContent>
            <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={() => navigate('/settings?tab=bays')}>
              {t('capacity.page.openBaySettings')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div
          aria-busy={capacity.isPlaceholderData}
          className={capacity.isPlaceholderData ? 'opacity-50 transition-opacity' : undefined}
        >
          <CapacityWeekGrid week={week} />
        </div>
      )}
    </div>
  )
}
