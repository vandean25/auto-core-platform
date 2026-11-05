import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport, type WorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { downloadCsv, serializeCsv } from '@/lib/csv'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PHONE_TOUCH_CONTROLS } from '@/lib/touch-targets'
import { cn } from '@/lib/utils'
import { dateDaysAgo, localIsoDate } from './workshop-kpi-format'
import { KpiFilters, LaborPerformanceCard, PartsTurnoverCard, type KpiGroupBy } from './workshop-kpi-report-cards'
import { PageHeader } from '@/components/layout/PageHeader'

type ReportsTranslate = TFunction<'reports'>

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
  const [groupBy, setGroupBy] = useState<KpiGroupBy>('mechanic')
  const selectedSiteId = siteId || session.data?.activeSiteId || sites.data?.[0]?.id || ''
  const report = useWorkshopKpiReport({ siteId: selectedSiteId, from, to, groupBy })
  const missingValue = t('common:placeholders.missing')

  const exportCsv = useCallback(() => {
    if (!report.data) return
    downloadCsv(serializeWorkshopKpiCsv(report.data, t), 'workshop-kpis.csv')
  }, [report.data, t])

  return (
    <div className={cn('space-y-6', PHONE_TOUCH_CONTROLS)}>
      <PageHeader
        className="mb-0"
        title={t('workshopKpi.pageTitle')}
        description={t('workshopKpi.pageDescription')}
        actions={
          <Button onClick={exportCsv} disabled={!report.data}>
            <Download className="mr-2 h-4 w-4" />
            {t('workshopKpi.exportCsv')}
          </Button>
        }
      />
      <KpiFilters
        sites={sites.data ?? []}
        siteId={selectedSiteId}
        from={from}
        to={to}
        groupBy={groupBy}
        onSiteChange={setSiteId}
        onFromChange={setFrom}
        onToChange={setTo}
        onGroupByChange={setGroupBy}
      />
      {report.isError && <p role="alert" className="text-sm text-destructive">{report.error.message}</p>}
      <LaborPerformanceCard report={report.data} isLoading={report.isLoading} missing={missingValue} />
      <PartsTurnoverCard report={report.data} missing={missingValue} />
    </div>
  )
}
