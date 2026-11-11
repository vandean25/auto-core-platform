import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { showQuerySurfaceSkeleton } from '@/features/interaction/query-surface-loading'
import { WidgetBody, WidgetEmptyMessage } from '@/features/dashboard-widgets/DashboardWidgetBodies'
import { isPartialResult, type WidgetData } from '@/features/dashboard-widgets/widget-totals'
import type { DashboardWidget, DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { useWidgetRows } from './use-widget-rows'

type DashboardWidgetCardProps = {
  widget: DashboardWidget
  source: DashboardWidgetTableSource
  onRemove: () => void
}

function DashboardWidgetCardBody({
  showLoading,
  error,
  rows,
  data,
  widget,
  source,
}: {
  showLoading: boolean
  error: Error | null
  rows: WidgetData['rows']
  data: WidgetData | undefined
  widget: DashboardWidget
  source: DashboardWidgetTableSource
}) {
  const { t } = useTranslation('common')
  if (showLoading) {
    return <p className="text-sm text-muted-foreground">{t('dashboard.loadingWidget')}</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{t('dashboard.loadWidgetFailed')}</p>
  }
  if (rows.length === 0) {
    return <WidgetEmptyMessage data={data} />
  }
  if (!data) {
    return null
  }
  return (
    <>
      <WidgetBody widget={widget} source={source} data={data} />
      {isPartialResult(widget, data) ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="widget-partial-hint">
          {t('dashboard.partialResult', { count: data.fetchedCount, total: data.total })}
        </p>
      ) : null}
    </>
  )
}

export function DashboardWidgetCard({ widget, source, onRemove }: DashboardWidgetCardProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { data, isPending, isFetching, error } = useWidgetRows(widget)
  const rows = useMemo(() => data?.rows ?? [], [data])
  const showLoading = showQuerySurfaceSkeleton(isPending, data, isFetching)

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
            <CardTitle className="text-base font-semibold hover:text-primary transition-colors">{widget.name}</CardTitle>
          </button>
          <p className="text-xs text-muted-foreground mt-1">{t(source.labelKey)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label={t('dashboard.removeWidgetAria', { name: widget.name })}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <DashboardWidgetCardBody
          showLoading={showLoading}
          error={error}
          rows={rows}
          data={data}
          widget={widget}
          source={source}
        />
      </CardContent>
    </Card>
  )
}
