import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fetchRowsForWidgetHref } from '@/features/dashboard-widgets/data-source-registry'
import { useDashboardWidgets } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import type { DashboardWidget, DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { getValueByPath, stringifyValue, toNumber } from '@/features/dashboard-widgets/utils'

const DONUT_COLORS = ['#0ea5e9', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#6366f1']

type DashboardWidgetsGridProps = {
  sourcesByKey: Record<string, DashboardWidgetTableSource>
}

function useWidgetRows(widget: DashboardWidget) {
  return useQuery({
    queryKey: ['dashboard-widget-data', widget.sourceKey, widget.id, widget.href],
    queryFn: () => fetchRowsForWidgetHref(widget.href),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

function appendGroupFilterToHref(href: string, field: string, value: string): string {
  const url = new URL(href, 'http://localhost')
  url.searchParams.set(`filter_${field}`, value)
  return `${url.pathname}${url.search}`
}

function renderListPreviewRow(row: unknown, source: DashboardWidgetTableSource): string {
  const previewFields = source.listPreviewFields.length > 0 ? source.listPreviewFields : source.fields.map((field) => field.key)
  const text = previewFields
    .map((fieldKey) => stringifyValue(getValueByPath(row, fieldKey)))
    .filter(Boolean)
    .join(' · ')
  return text || 'No preview data'
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
  const navigate = useNavigate()
  const { data: rows = [], isLoading, error } = useWidgetRows(widget)

  const donutData = useMemo(() => {
    if (widget.displayType !== 'donut' || !widget.groupByField) return []
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = stringifyValue(getValueByPath(row, widget.groupByField)) || 'Unknown'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }))
  }, [rows, widget.displayType, widget.groupByField])

  const metricValue = useMemo<number | null>(() => {
    if (widget.displayType !== 'metric') return null
    if (widget.metricCalculation !== 'sum' || !widget.metricField) {
      return rows.length
    }
    return rows.reduce<number>((sum, row) => sum + toNumber(getValueByPath(row, widget.metricField ?? '')), 0)
  }, [rows, widget.displayType, widget.metricCalculation, widget.metricField])

  const metricFieldType = source.fields.find((field) => field.key === widget.metricField)?.type
  const formattedMetricValue = useMemo(() => {
    if (metricValue == null) return '-'
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
    const currency = (widget as any).metricCurrency || 'EUR'

    if (widget.metricCalculation === 'sum' && metricFieldType === 'currency') {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(metricValue)
    }
    if (widget.metricCalculation === 'sum') {
      return new Intl.NumberFormat(locale).format(metricValue)
    }
    return `${metricValue}`
  }, [metricValue, widget.metricCalculation, metricFieldType, widget])

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <button
            type="button"
            className="text-left"
            onClick={() => navigate(widget.href)}
            title="Open source table with saved filters"
          >
            <CardTitle className="text-base font-semibold hover:text-primary transition-colors">{widget.name}</CardTitle>
          </button>
          <p className="text-xs text-slate-500 mt-1">{source.sourceLabel}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove widget ${widget.name}`}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-slate-500">Loading widget...</p> : null}
        {error ? <p className="text-sm text-destructive">Unable to load widget data.</p> : null}
        {!isLoading && !error && rows.length === 0 ? <p className="text-sm text-slate-500">No data for this widget.</p> : null}

        {!isLoading && !error && rows.length > 0 && widget.displayType === 'list' ? (
          <ul className="space-y-2">
            {rows.slice(0, 5).map((row, index) => (
              <li key={`${widget.id}-row-${index}`} className="text-sm text-slate-700 border-b pb-2 last:border-b-0">
                {renderListPreviewRow(row, source)}
              </li>
            ))}
          </ul>
        ) : null}

        {!isLoading && !error && rows.length > 0 && widget.displayType === 'metric' ? (
          <button
            type="button"
            className="w-full rounded-lg border border-transparent py-8 text-center transition hover:border-slate-200"
            onClick={() => navigate(widget.href)}
            title="Open source table with saved filters"
          >
            <div className="text-4xl font-bold tracking-tight">{formattedMetricValue}</div>
            <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
              {widget.metricCalculation === 'sum' ? 'Summed Value' : 'Total Items'}
            </div>
          </button>
        ) : null}

        {!isLoading && !error && rows.length > 0 && widget.displayType === 'donut' ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={85}
                  onClick={(entry) => {
                    if (!widget.groupByField) return
                    navigate(appendGroupFilterToHref(widget.href, widget.groupByField, String(entry.name)))
                  }}
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`${widget.id}-${entry.name}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" align="center" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DashboardWidgetsGrid({ sourcesByKey }: DashboardWidgetsGridProps) {
  const { widgets, removeWidget } = useDashboardWidgets()

  if (widgets.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-slate-500">
            No widgets yet. Open a list view, apply filters, then click Add to Dashboard.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {widgets.map((widget) => {
        const source = sourcesByKey[widget.sourceKey]
        if (!source) {
          return (
            <Card key={widget.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                <CardTitle className="text-base font-semibold">{widget.name}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => removeWidget(widget.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">Widget source is no longer available.</p>
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
