import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { selectEffectiveCapabilities, useAuthSession } from '@/api/auth-session'
import { Info, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dashboardWidgetKeys } from '@/features/dashboard-widgets/dashboard-widget-keys'
import {
  fetchWidgetRows,
  filterWidgetRows,
  resolveWidgetRequest,
  type WidgetRowsResult,
} from '@/features/dashboard-widgets/data-source-registry'
import { useDashboardWidgets } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import type { DashboardWidget, DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { WidgetBody, WidgetEmptyMessage } from '@/features/dashboard-widgets/DashboardWidgetBodies'
import { isPartialResult, type WidgetData } from '@/features/dashboard-widgets/widget-totals'
import { resolveDashboardWidgetDisplayName } from '@/features/dashboard-widgets/widget-display-name'
import { hasUtcDayChanged } from '@/lib/date-utils'

const PICKERL_DUE_SOURCE_KEY = 'pickerl-due'

type DashboardWidgetsGridProps = {
  sourcesByKey: Record<string, DashboardWidgetTableSource>
}

const NO_ROWS: WidgetRowsResult = { rows: [], total: 0 }

/** Widgets on the same source and API URL share one request; their own filters are applied to the shared rows. */
function useWidgetRows(widget: DashboardWidget) {
  const request = useMemo(() => resolveWidgetRequest(widget.href), [widget.href])
  const select = useCallback(
    (result: WidgetRowsResult): WidgetData => ({
      rows: filterWidgetRows(result.rows, request),
      fetchedCount: result.rows.length,
      total: result.total,
      hasClientFilters: request?.hasClientOnlyFilters ?? false,
    }),
    [request],
  )

  return useQuery({
    queryKey: dashboardWidgetKeys.rows(widget.sourceKey, request?.apiUrl ?? widget.href),
    queryFn: () => (request ? fetchWidgetRows(request.apiUrl, widget.sourceKey) : NO_ROWS),
    select,
    staleTime: 1000 * 60 * 5, // 5 minutes
    // Realtime events and mutations refresh the rows, so returning to the tab does not refetch every widget list. The
    // Pickerl due status depends on the current day, though, so data from an earlier day is refreshed when the tab is
    // shown again.
    refetchOnWindowFocus: (query) =>
      widget.sourceKey === PICKERL_DUE_SOURCE_KEY && hasUtcDayChanged(query.state.dataUpdatedAt) ? 'always' : false,
  })
}

function DashboardWidgetCard({
  widget,
  source,
  onRemove,
}: {
  widget: DashboardWidget
  source: DashboardWidgetTableSource
  onRemove: () => void
}) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { data, isLoading, error } = useWidgetRows(widget)
  const rows = useMemo(() => data?.rows ?? [], [data])
  const hasRows = !isLoading && !error && rows.length > 0
  const displayName = useMemo(
    () => resolveDashboardWidgetDisplayName(widget, source, t),
    [widget, source, t],
  )

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <button
            type="button"
            className="text-left"
            onClick={() => navigate(widget.href)}
            title={t('dashboard.openSourceTitle')}
          >
            <CardTitle className="text-base font-semibold hover:text-primary transition-colors">{displayName}</CardTitle>
          </button>
          <p className="text-xs text-muted-foreground mt-1">{t(source.labelKey)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label={t('dashboard.removeWidgetAria', { name: displayName })}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">{t('dashboard.loadingWidget')}</p> : null}
        {error ? <p className="text-sm text-destructive">{t('dashboard.loadWidgetFailed')}</p> : null}
        {!isLoading && !error && rows.length === 0 ? <WidgetEmptyMessage data={data} /> : null}

        {hasRows && data ? <WidgetBody widget={widget} source={source} data={data} /> : null}
        {hasRows && data && isPartialResult(widget, data) ? (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="widget-partial-hint">
            {t('dashboard.partialResult', { count: data.fetchedCount, total: data.total })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DashboardWidgetsGrid({ sourcesByKey }: DashboardWidgetsGridProps) {
  const { t } = useTranslation('common')
  const { widgets, removeWidget } = useDashboardWidgets()
  const capabilities = selectEffectiveCapabilities(useAuthSession().data)
  const visibleWidgets = widgets.filter((widget) => widget.sourceKey !== PICKERL_DUE_SOURCE_KEY || capabilities?.pickerl57a === true)

  if (widgets.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-muted-foreground">{t('dashboard.emptyWidgets')}</p>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 sm:h-5 sm:w-5 text-muted-foreground hover:text-foreground"
                  aria-label={t('dashboard.emptyWidgetsInfoAria')}
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-xs text-muted-foreground" aria-label={t('dashboard.emptyWidgetsInfoAria')}>
                {t('dashboard.emptyWidgetsHint')}
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 dashboard-widgets-grid">
      {visibleWidgets.map((widget) => {
        const source = sourcesByKey[widget.sourceKey]
        const displayName = source
          ? resolveDashboardWidgetDisplayName(widget, source, t)
          : widget.name
        if (!source) {
          return (
            <Card key={widget.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                <CardTitle className="text-base font-semibold">{displayName}</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeWidget(widget.id)}
                  aria-label={t('dashboard.removeWidgetAria', { name: displayName })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('dashboard.sourceUnavailable')}</p>
              </CardContent>
            </Card>
          )
        }
        return (
          <DashboardWidgetCard
            key={widget.id}
            widget={widget}
            source={source}
            onRemove={() => removeWidget(widget.id)}
          />
        )
      })}
    </div>
  )
}
