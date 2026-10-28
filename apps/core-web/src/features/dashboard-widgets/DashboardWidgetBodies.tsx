import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { DashboardWidget, DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { getValueByPath, stringifyValue, toNumber } from '@/features/dashboard-widgets/utils'
import { isTruncated, widgetCount, type WidgetData } from '@/features/dashboard-widgets/widget-totals'
import { formatCurrency, formatNumber } from '@/lib/format'

const DONUT_COLORS = ['#0ea5e9', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#6366f1']

type WidgetBodyProps = {
  widget: DashboardWidget
  source: DashboardWidgetTableSource
  data: WidgetData
}

function appendGroupFilterToHref(href: string, field: string, value: string): string {
  const url = new URL(href, 'http://localhost')
  url.searchParams.set(`filter_${field}`, value)
  return `${url.pathname}${url.search}`
}

function renderListPreviewRow(row: unknown, source: DashboardWidgetTableSource, noPreviewLabel: string): string {
  const previewFields = source.listPreviewFields.length > 0 ? source.listPreviewFields : source.fields.map((field) => field.key)
  const text = previewFields
    .map((fieldKey) => stringifyValue(getValueByPath(row, fieldKey)))
    .filter(Boolean)
    .join(' · ')
  return text || noPreviewLabel
}

function WidgetListBody({ widget, source, data }: WidgetBodyProps) {
  const { t } = useTranslation('common')
  return (
    <ul className="space-y-2">
      {data.rows.slice(0, 5).map((row, index) => (
        <li key={`${widget.id}-row-${index}`} className="text-sm text-slate-700 border-b pb-2 last:border-b-0">
          {renderListPreviewRow(row, source, t('dashboard.noPreviewData'))}
        </li>
      ))}
    </ul>
  )
}

function formatMetric(widget: DashboardWidget, value: number, fieldType: string | undefined): string {
  if (widget.metricCalculation !== 'sum') return `${value}`
  if (fieldType !== 'currency') return formatNumber(value)
  const currency = (widget as { metricCurrency?: unknown }).metricCurrency
  return formatCurrency(value, typeof currency === 'string' ? currency : 'EUR')
}

function WidgetMetricBody({ widget, source, data }: WidgetBodyProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const isSum = widget.metricCalculation === 'sum' && Boolean(widget.metricField)
  const count = widgetCount(data)
  const value = isSum
    ? data.rows.reduce<number>((sum, row) => sum + toNumber(getValueByPath(row, widget.metricField ?? '')), 0)
    : count.value
  const fieldType = source.fields.find((field) => field.key === widget.metricField)?.type

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-transparent py-8 text-center transition hover:border-slate-200"
      onClick={() => navigate(widget.href)}
      title={t('dashboard.openSourceTitle')}
    >
      <div className="text-4xl font-bold tracking-tight">
        {isSum ? formatMetric(widget, value, fieldType) : `${value}${count.isLowerBound ? '+' : ''}`}
      </div>
      <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
        {widget.metricCalculation === 'sum' ? t('dashboard.summedValue') : t('dashboard.totalItems')}
      </div>
    </button>
  )
}

function WidgetDonutBody({ widget, data }: WidgetBodyProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const donutData = useMemo(() => {
    if (!widget.groupByField) return []
    const counts = new Map<string, number>()
    for (const row of data.rows) {
      const key = stringifyValue(getValueByPath(row, widget.groupByField)) || t('dashboard.unknownGroup')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }))
  }, [data.rows, t, widget.groupByField])

  return (
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
  )
}

/** What a widget shows without rows: no data, or, after a truncated fetch, that only the fetched part had no match. */
export function WidgetEmptyMessage({ data }: { data: WidgetData | undefined }) {
  const { t } = useTranslation('common')
  const isPartial = data ? isTruncated(data) : false
  return (
    <p className="text-sm text-slate-500" data-testid={isPartial ? 'widget-partial-empty' : undefined}>
      {data && isPartial
        ? t('dashboard.noWidgetDataPartial', { count: data.fetchedCount, total: data.total })
        : t('dashboard.noWidgetData')}
    </p>
  )
}

/** The body of a widget card for its display type. */
export function WidgetBody(props: WidgetBodyProps) {
  switch (props.widget.displayType) {
    case 'list':
      return <WidgetListBody {...props} />
    case 'metric':
      return <WidgetMetricBody {...props} />
    case 'donut':
      return <WidgetDonutBody {...props} />
    default:
      return null
  }
}
