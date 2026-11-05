import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DateField } from '@/components/ui/date-field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableSkeleton } from '@/components/ui/skeleton-presets'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { WorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { formatNumber } from '@/lib/format'
import { formatKpiPeriod, money, number } from './workshop-kpi-format'

export type KpiGroupBy = 'mechanic' | 'week' | 'month'

function EmptyRow({ colSpan, children }: { colSpan: number; children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Empty className="p-4 md:p-4">
          <EmptyDescription>{children}</EmptyDescription>
        </Empty>
      </TableCell>
    </TableRow>
  )
}

export function KpiFilters({
  sites,
  siteId,
  from,
  to,
  groupBy,
  onSiteChange,
  onFromChange,
  onToChange,
  onGroupByChange,
}: {
  sites: Array<{ id: string; name: string }>
  siteId: string
  from: string
  to: string
  groupBy: KpiGroupBy
  onSiteChange: (id: string) => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onGroupByChange: (value: KpiGroupBy) => void
}) {
  const { t } = useTranslation(['reports', 'common'])

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1 text-sm">
        <label htmlFor="workshop-report-site">{t('workshopKpi.site')}</label>
        <Select value={siteId} onValueChange={onSiteChange}>
          <SelectTrigger id="workshop-report-site" className="w-52">
            <SelectValue placeholder={t('workshopKpi.sitePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1 text-sm">
        <label htmlFor="workshop-report-from">{t('workshopKpi.from')}</label>
        <DateField id="workshop-report-from" aria-label={t('workshopKpi.from')} value={from} onChange={onFromChange} className="h-10" />
      </div>
      <div className="grid gap-1 text-sm">
        <label htmlFor="workshop-report-to">{t('workshopKpi.to')}</label>
        <DateField id="workshop-report-to" aria-label={t('workshopKpi.to')} value={to} onChange={onToChange} className="h-10" />
      </div>
      <div className="grid gap-1 text-sm">
        <label htmlFor="workshop-report-group">{t('workshopKpi.groupBy')}</label>
        <Select value={groupBy} onValueChange={(value) => onGroupByChange(value as KpiGroupBy)}>
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
  )
}

type LaborRow = WorkshopKpiReport['data'][number]

function LaborRowCells({ row, missing }: { row: LaborRow; missing: string }) {
  const { t } = useTranslation(['reports', 'common'])

  return (
    <>
      <TableCell>{row.mechanic_name ?? t('workshopKpi.total')}</TableCell>
      <TableCell>{formatKpiPeriod(row.period)}</TableCell>
      <TableCell>{number(row.available_hours, '', missing)}</TableCell>
      <TableCell>{number(row.clocked_hours, '', missing)}</TableCell>
      <TableCell>{number(row.sold_hours, '', missing)}</TableCell>
      <TableCell>{money(row.labor_net_revenue, missing)}</TableCell>
      <TableCell>{money(row.parts_net_revenue, missing)}</TableCell>
      <TableCell>{number(row.utilisation_percent, ' %', missing)}</TableCell>
      <TableCell>{number(row.productivity_percent, ' %', missing)}</TableCell>
      <TableCell>{row.closed_orders}</TableCell>
      <TableCell>{money(row.average_net_revenue_per_order, missing)}</TableCell>
      <TableCell>{row.open_labor_entry_count}</TableCell>
    </>
  )
}

function LaborBody({ report, isLoading, missing }: { report: WorkshopKpiReport | undefined; isLoading: boolean; missing: string }) {
  const { t } = useTranslation(['reports', 'common'])

  if (isLoading) return <TableSkeleton cols={12} />
  const rows = report ? [...report.data, report.totals] : []
  if (!report?.data.length) return <EmptyRow colSpan={12}>{t('workshopKpi.laborPerformance.empty')}</EmptyRow>

  return rows.map((row) => (
    <TableRow key={row.key}>
      <LaborRowCells row={row} missing={missing} />
    </TableRow>
  ))
}

export function LaborPerformanceCard({
  report,
  isLoading,
  missing,
}: {
  report: WorkshopKpiReport | undefined
  isLoading: boolean
  missing: string
}) {
  const { t } = useTranslation(['reports', 'common'])
  const headings = useMemo(
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('workshopKpi.laborPerformance.title')}</CardTitle>
      </CardHeader>
      <CardContent className="[contain:inline-size]">
        <Table className="max-sm:min-w-max max-sm:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              {headings.map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <LaborBody report={report} isLoading={isLoading} missing={missing} />
          </TableBody>
        </Table>
        {report && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('workshopKpi.laborPerformance.metaFooter', {
              timezone: report.meta.timezone,
              count: report.meta.unassigned_mechanic_count,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SlowMoverRows({ report, missing }: { report: WorkshopKpiReport | undefined; missing: string }) {
  const { t } = useTranslation(['reports', 'common'])
  const movers = report?.parts_turnover.slow_movers ?? []

  if (movers.length === 0) return <EmptyRow colSpan={4}>{t('workshopKpi.partsTurnover.slowMoversEmpty')}</EmptyRow>

  return movers.map((part) => (
    <TableRow key={part.catalog_item_id}>
      <TableCell>{part.sku} · {part.name}</TableCell>
      <TableCell>
        {formatNumber(Number(part.quantity_on_hand), { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
      </TableCell>
      <TableCell>{money(part.stock_value, missing)}</TableCell>
      <TableCell>{part.days_since_last_issue ?? t('workshopKpi.never')}</TableCell>
    </TableRow>
  ))
}

export function PartsTurnoverCard({ report, missing }: { report: WorkshopKpiReport | undefined; missing: string }) {
  const { t } = useTranslation(['reports', 'common'])
  const turnover = report?.parts_turnover

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('workshopKpi.partsTurnover.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          {t('workshopKpi.partsTurnover.summary', {
            issuedCost: money(turnover?.issued_cost, missing),
            averageStock: money(turnover?.average_stock_value, missing),
            turnover: number(turnover?.turnover, '×', missing),
          })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('workshopKpi.partsTurnover.unvaluedStock', { count: turnover?.unvalued_stock_item_count ?? 0 })}
        </p>
        <h3 className="mb-2 mt-5 text-sm font-semibold">{t('workshopKpi.partsTurnover.slowMoversTitle')}</h3>
        <div className="[contain:inline-size]">
          <Table className="max-sm:min-w-max max-sm:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>{t('workshopKpi.partsTurnover.columns.article')}</TableHead>
                <TableHead>{t('workshopKpi.partsTurnover.columns.quantity')}</TableHead>
                <TableHead>{t('workshopKpi.partsTurnover.columns.stockValue')}</TableHead>
                <TableHead>{t('workshopKpi.partsTurnover.columns.daysSinceIssue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SlowMoverRows report={report} missing={missing} />
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
