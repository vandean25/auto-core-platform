import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { useAuthSession } from '@/api/auth-session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport, type WorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { downloadCsv, serializeCsv } from '@/lib/csv'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { formatNumber } from '@/lib/format'

type ReportsTranslate = TFunction<'reports'>

function number(value: string | null | undefined, suffix = '', missing = '—'): string {
  return value == null
    ? missing
    : `${formatNumber(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
}

export function serializeWorkshopKpiCsv(report: WorkshopKpiReport, t: ReportsTranslate): string {
  const headers = [
    t('workshopKpi.csv.headers.dataType'),
    t('workshopKpi.csv.headers.mechanic'),
    t('workshopKpi.csv.headers.period'),
    t('workshopKpi.csv.headers.availableHours'),
    t('workshopKpi.csv.headers.clockedHours'),
    t('workshopKpi.csv.headers.soldHours'),
    t('workshopKpi.csv.headers.laborNetRevenueEur'),
    t('workshopKpi.csv.headers.partsNetRevenueEur'),
    t('workshopKpi.csv.headers.utilisationPercent'),
    t('workshopKpi.csv.headers.productivityPercent'),
    t('workshopKpi.csv.headers.closedOrders'),
    t('workshopKpi.csv.headers.avgNetRevenuePerOrderEur'),
    t('workshopKpi.csv.headers.openLaborEntries'),
    t('workshopKpi.csv.headers.issuedCostEur'),
    t('workshopKpi.csv.headers.averageStockValueEur'),
    t('workshopKpi.csv.headers.turnover'),
    t('workshopKpi.csv.headers.unvaluedStockItems'),
    t('workshopKpi.csv.headers.sku'),
    t('workshopKpi.csv.headers.article'),
    t('workshopKpi.csv.headers.quantity'),
    t('workshopKpi.csv.headers.stockValueEur'),
    t('workshopKpi.csv.headers.daysSinceIssue'),
    t('workshopKpi.csv.headers.siteTimezone'),
    t('workshopKpi.csv.headers.grouping'),
    t('workshopKpi.csv.headers.unassignedMechanics'),
  ]
  const emptyWorkMetrics = ['', '', '', '', '', '', '', '', '', '']
  const emptyTurnoverMetrics = ['', '', '', '']
  const emptySlowMoverDetails = ['', '', '', '', '']
  const dateRange = `${report.meta.from}–${report.meta.to}`
  const workRows = [...report.data, report.totals].map((row) => [
    t('workshopKpi.csv.rowTypes.workPerformance'),
    row.mechanic_name ?? t('workshopKpi.total'),
    row.period,
    row.available_hours,
    row.clocked_hours,
    row.sold_hours,
    row.labor_net_revenue,
    row.parts_net_revenue,
    row.utilisation_percent ?? '',
    row.productivity_percent ?? '',
    String(row.closed_orders),
    row.average_net_revenue_per_order ?? '',
    String(row.open_labor_entry_count),
    ...emptyTurnoverMetrics,
    ...emptySlowMoverDetails,
    '',
    '',
    '',
  ])
  const turnoverRow = [
    t('workshopKpi.csv.rowTypes.partsTurnover'),
    '',
    dateRange,
    ...emptyWorkMetrics,
    report.parts_turnover.issued_cost,
    report.parts_turnover.average_stock_value ?? '',
    report.parts_turnover.turnover ?? '',
    String(report.parts_turnover.unvalued_stock_item_count),
    ...emptySlowMoverDetails,
    '',
    '',
    '',
  ]
  const slowMoverRows = report.parts_turnover.slow_movers.map((part) => [
    t('workshopKpi.csv.rowTypes.slowMover'),
    '',
    dateRange,
    ...emptyWorkMetrics,
    ...emptyTurnoverMetrics,
    part.sku,
    part.name,
    part.quantity_on_hand,
    part.stock_value ?? '',
    part.days_since_last_issue === null ? t('workshopKpi.never') : String(part.days_since_last_issue),
    '',
    '',
    '',
  ])
  const reportInfoRow = [
    t('workshopKpi.csv.rowTypes.reportInfo'),
    '',
    dateRange,
    ...emptyWorkMetrics,
    ...emptyTurnoverMetrics,
    ...emptySlowMoverDetails,
    report.meta.timezone,
    report.meta.groupBy,
    String(report.meta.unassigned_mechanic_count),
  ]

  return serializeCsv([headers, ...workRows, turnoverRow, ...slowMoverRows, reportInfoRow])
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localIsoDate(date)
}

export default function WorkshopKpiReportsPage() {
  const { t } = useTranslation(['reports', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('reports')
  }, [])

  const session = useAuthSession()
  const sites = useMySites()
  const [siteId, setSiteId] = useState('')
  const [from, setFrom] = useState(() => dateDaysAgo(29))
  const [to, setTo] = useState(() => localIsoDate(new Date()))
  const [groupBy, setGroupBy] = useState<'mechanic' | 'week' | 'month'>('mechanic')
  const selectedSiteId = siteId || session.data?.activeSiteId || sites.data?.[0]?.id || ''
  const report = useWorkshopKpiReport({ siteId: selectedSiteId, from, to, groupBy })
  const rows = report.data?.data ?? []
  const visibleRows = rows

  const missingValue = t('common:placeholders.missing')

  const laborColumnHeadings = useMemo(
    () => [
      t('workshopKpi.laborPerformance.columns.mechanic'),
      t('workshopKpi.laborPerformance.columns.period'),
      t('workshopKpi.laborPerformance.columns.available'),
      t('workshopKpi.laborPerformance.columns.clocked'),
      t('workshopKpi.laborPerformance.columns.sold'),
      t('workshopKpi.laborPerformance.columns.laborNet'),
      t('workshopKpi.laborPerformance.columns.partsNet'),
      t('workshopKpi.laborPerformance.columns.utilisation'),
      t('workshopKpi.laborPerformance.columns.productivity'),
      t('workshopKpi.laborPerformance.columns.orders'),
      t('workshopKpi.laborPerformance.columns.avgNetPerOrder'),
      t('workshopKpi.laborPerformance.columns.openTimes'),
    ],
    [t],
  )

  const exportCsv = useCallback(() => {
    if (!report.data) return
    downloadCsv(serializeWorkshopKpiCsv(report.data, t), 'workshop-kpis.csv')
  }, [report.data, t])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('workshopKpi.pageTitle')}</h1>
          <p className="text-slate-500">{t('workshopKpi.pageDescription')}</p>
        </div>
        <Button onClick={exportCsv} disabled={!report.data}>
          <Download className="mr-2 h-4 w-4" />
          {t('workshopKpi.exportCsv')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1 text-sm">
          <label htmlFor="workshop-report-site">{t('workshopKpi.site')}</label>
          <Select value={selectedSiteId} onValueChange={setSiteId}>
            <SelectTrigger id="workshop-report-site" className="w-52">
              <SelectValue placeholder={t('workshopKpi.sitePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(sites.data ?? []).map((site) => (
                <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor="workshop-report-from">{t('workshopKpi.from')}</label>
          <input id="workshop-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-md border px-3" />
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor="workshop-report-to">{t('workshopKpi.to')}</label>
          <input id="workshop-report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-md border px-3" />
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor="workshop-report-group">{t('workshopKpi.groupBy')}</label>
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as typeof groupBy)}>
            <SelectTrigger id="workshop-report-group" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mechanic">{t('workshopKpi.groupByOptions.mechanic')}</SelectItem>
              <SelectItem value="week">{t('workshopKpi.groupByOptions.week')}</SelectItem>
              <SelectItem value="month">{t('workshopKpi.groupByOptions.month')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {report.isError && <p role="alert" className="text-sm text-red-600">{report.error.message}</p>}
      <Card>
        <CardHeader>
          <CardTitle>{t('workshopKpi.laborPerformance.title')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                {laborColumnHeadings.map((heading) => (
                  <th key={heading} className="p-2">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.isLoading ? (
                <tr>
                  <td className="p-4" colSpan={12}>{t('workshopKpi.laborPerformance.loading')}</td>
                </tr>
              ) : visibleRows.length ? (
                [...visibleRows, ...(report.data ? [report.data.totals] : [])].map((row) => (
                  <tr key={row.key} className="border-b">
                    <td className="p-2">{row.mechanic_name ?? t('workshopKpi.total')}</td>
                    <td className="p-2">{row.period}</td>
                    <td className="p-2">{number(row.available_hours, '', missingValue)}</td>
                    <td className="p-2">{number(row.clocked_hours, '', missingValue)}</td>
                    <td className="p-2">{number(row.sold_hours, '', missingValue)}</td>
                    <td className="p-2">{number(row.labor_net_revenue, ' €', missingValue)}</td>
                    <td className="p-2">{number(row.parts_net_revenue, ' €', missingValue)}</td>
                    <td className="p-2">{number(row.utilisation_percent, ' %', missingValue)}</td>
                    <td className="p-2">{number(row.productivity_percent, ' %', missingValue)}</td>
                    <td className="p-2">{row.closed_orders}</td>
                    <td className="p-2">{number(row.average_net_revenue_per_order, ' €', missingValue)}</td>
                    <td className="p-2">{row.open_labor_entry_count}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="p-4 text-slate-500" colSpan={12}>{t('workshopKpi.laborPerformance.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
          {report.data && (
            <p className="mt-3 text-xs text-slate-500">
              {t('workshopKpi.laborPerformance.metaFooter', {
                timezone: report.data.meta.timezone,
                count: report.data.meta.unassigned_mechanic_count,
              })}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('workshopKpi.partsTurnover.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {t('workshopKpi.partsTurnover.summary', {
              issuedCost: number(report.data?.parts_turnover.issued_cost, ' €', missingValue),
              averageStock: number(report.data?.parts_turnover.average_stock_value, ' €', missingValue),
              turnover: number(report.data?.parts_turnover.turnover, '×', missingValue),
            })}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('workshopKpi.partsTurnover.unvaluedStock', {
              count: report.data?.parts_turnover.unvalued_stock_item_count ?? 0,
            })}
          </p>
          <h3 className="mb-2 mt-5 text-sm font-semibold">{t('workshopKpi.partsTurnover.slowMoversTitle')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">{t('workshopKpi.partsTurnover.columns.article')}</th>
                  <th className="p-2">{t('workshopKpi.partsTurnover.columns.quantity')}</th>
                  <th className="p-2">{t('workshopKpi.partsTurnover.columns.stockValue')}</th>
                  <th className="p-2">{t('workshopKpi.partsTurnover.columns.daysSinceIssue')}</th>
                </tr>
              </thead>
              <tbody>
                {report.data?.parts_turnover.slow_movers.length ? (
                  report.data.parts_turnover.slow_movers.map((part) => (
                    <tr key={part.catalog_item_id} className="border-b">
                      <td className="p-2">{part.sku} · {part.name}</td>
                      <td className="p-2">
                        {formatNumber(Number(part.quantity_on_hand), { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                      </td>
                      <td className="p-2">{number(part.stock_value, ' €', missingValue)}</td>
                      <td className="p-2">{part.days_since_last_issue ?? t('workshopKpi.never')}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="p-3 text-slate-500" colSpan={4}>{t('workshopKpi.partsTurnover.slowMoversEmpty')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
