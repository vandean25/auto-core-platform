import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useVehicleStockAgeReport, useVehicleStockMarginReport, type VehicleStockAgeBucket, type VehicleStockAgeReportRow, type VehicleStockMarginReportRow } from '@/api/vehicle-stock'
import { downloadCsv, serializeCsv } from '@/lib/csv'
import { formatDate } from '@/lib/format'
import type { TFunction } from 'i18next'

type ReportTab = 'age' | 'margin'

type ReportsTranslate = TFunction<'vehicleStock'>

const AGE_BUCKET_KEYS = ['0_30', '31_60', '61_90', '91_180', 'over_180', 'over_90'] as const

function csvAmount(value: string | null): string {
  return value ? value.replace('.', ',') : ''
}

function inventoryRoleLabel(role: string, t: ReportsTranslate) {
  if (role === 'USED' || role === 'NEW' || role === 'DEMO') {
    return t(`reports.roles.${role}`)
  }
  return role
}

function marginTaxLabel(marginTaxed: boolean, t: ReportsTranslate) {
  return marginTaxed ? t('reports.taxMode.margin') : t('reports.taxMode.standard')
}

export function serializeStockAgeCsv(rows: VehicleStockAgeReportRow[], t: ReportsTranslate): string {
  const header = [
    t('reports.csvAge.make'),
    t('reports.csvAge.model'),
    t('reports.csvAge.year'),
    t('reports.csvAge.vin'),
    t('reports.csvAge.plate'),
    t('reports.csvAge.role'),
    t('reports.csvAge.status'),
    t('reports.csvAge.daysInStock'),
    t('reports.csvAge.costBasisEur'),
    t('reports.csvAge.askingPriceEur'),
    t('reports.csvAge.location'),
  ]
  const body = rows.map((row) => [
    row.make, row.model, String(row.year), row.vin ?? '', row.plate ?? '', inventoryRoleLabel(row.inventory_role, t),
    row.stock_status ?? '', row.days_in_stock === null ? '' : String(row.days_in_stock),
    csvAmount(row.cost_basis), csvAmount(row.asking_price), row.location ?? '',
  ])
  return serializeCsv([header, ...body])
}

export function serializeMarginCsv(rows: VehicleStockMarginReportRow[], t: ReportsTranslate): string {
  const header = [
    t('reports.csvMargin.invoiceDate'),
    t('reports.csvMargin.saleNumber'),
    t('reports.csvMargin.make'),
    t('reports.csvMargin.model'),
    t('reports.csvMargin.year'),
    t('reports.csvMargin.role'),
    t('reports.csvMargin.netSaleEur'),
    t('reports.csvMargin.costBasisEur'),
    t('reports.csvMargin.grossMarginEur'),
    t('reports.csvMargin.grossMarginPercent'),
    t('reports.csvMargin.daysToSell'),
    t('reports.csvMargin.marginTaxation'),
  ]
  const body = rows.map((row) => [
    formatDate(row.invoice_date), row.sale_number, row.make, row.model,
    String(row.year), inventoryRoleLabel(row.inventory_role, t), csvAmount(row.sale_price),
    csvAmount(row.cost_basis_snapshot), csvAmount(row.gross_margin_eur),
    csvAmount(row.gross_margin_percent), row.days_to_sell === null ? '' : String(row.days_to_sell),
    marginTaxLabel(row.margin_taxed, t),
  ])
  return serializeCsv([header, ...body])
}

export default function VehicleStockReportsPage() {
  const { t } = useTranslation('vehicleStock')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<ReportTab>('age')
  const [bucket, setBucket] = useState(searchParams.get('bucket') ?? 'ALL')
  const [inventoryRole, setInventoryRole] = useState('ALL')
  const [stockStatus, setStockStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const emDash = t('shared.emDash')

  const ageBuckets = useMemo(
    () =>
      AGE_BUCKET_KEYS.map((value) => ({
        value,
        label: t(`reports.ageBuckets.${value}`),
      })),
    [t],
  )

  const formatRole = (role: string) => {
    const key = `reports.roles.${role}` as 'reports.roles.USED'
    return t(key, { defaultValue: role })
  }

  const formatTaxMode = (marginTaxed: boolean) =>
    marginTaxed ? t('reports.taxMode.margin') : t('reports.taxMode.standard')

  const formatStockStatus = (status: string) => {
    const key = `reports.stockStatus.${status}` as 'reports.stockStatus.IN_STOCK'
    return t(key, { defaultValue: status })
  }

  const formatMoney = (value: string | null) => {
    return value === null ? emDash : `${csvAmount(value)}\u00a0€`
  }

  const ageFilters = {
    page, limit: 25,
    ...(bucket !== 'ALL' ? { bucket: bucket as VehicleStockAgeBucket } : {}),
    ...(inventoryRole !== 'ALL' ? { inventory_role: inventoryRole } : {}),
    ...(stockStatus !== 'ALL' ? { stock_status: stockStatus } : {}),
  }
  const ageReport = useVehicleStockAgeReport(ageFilters)
  const marginReport = useVehicleStockMarginReport({ from, to, page, limit: 25 })
  const ageRows = ageReport.data?.data ?? []
  const marginRows = marginReport.data?.data ?? []
  const activeRows = tab === 'age' ? ageRows : marginRows
  const pageCount = tab === 'age' ? ageReport.data?.meta.pageCount : marginReport.data?.meta.pageCount
  const isLoading = tab === 'age' ? ageReport.isLoading : marginReport.isLoading

  const stockAgeTableRows = ageRows
  const marginTableRows = marginRows

  const changeTab = (nextTab: ReportTab) => {
    setTab(nextTab)
    setPage(1)
  }

  const ageHeaders = [
    t('reports.ageTable.vehicle'),
    t('reports.ageTable.vin'),
    t('reports.ageTable.plate'),
    t('reports.ageTable.role'),
    t('reports.ageTable.status'),
    t('reports.ageTable.age'),
    t('reports.ageTable.costBasis'),
    t('reports.ageTable.askingPrice'),
    t('reports.ageTable.location'),
  ]

  const marginHeaders = [
    t('reports.marginTable.invoiceDate'),
    t('reports.marginTable.saleNumber'),
    t('reports.marginTable.vehicle'),
    t('reports.marginTable.role'),
    t('reports.marginTable.netSale'),
    t('reports.marginTable.costBasis'),
    t('reports.marginTable.grossMargin'),
    t('reports.marginTable.grossMarginPercent'),
    t('reports.marginTable.daysToSell'),
    t('reports.marginTable.taxation'),
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between max-sm:flex-wrap max-sm:gap-4 max-sm:[&_a]:min-h-11 max-sm:[&_button]:min-h-11">
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('reports.title')}</h1>
          <p className="text-slate-500">{t('reports.description')}</p>
        </div>
        <div className="flex gap-2 max-sm:flex-wrap">
          <Button variant="outline" onClick={() => navigate('/vehicle-stock')}>{t('reports.stock')}</Button>
          <Button onClick={() => downloadCsv(
            tab === 'age' ? serializeStockAgeCsv(stockAgeTableRows, t) : serializeMarginCsv(marginTableRows, t),
            tab === 'age' ? t('reports.csvAgeFilename') : t('reports.csvMarginFilename'),
          )}>
            <Download className="mr-2 h-4 w-4" /> {t('reports.exportCsv')}
          </Button>
        </div>
      </div>

      <div className="flex gap-2" role="tablist" aria-label={t('reports.tabsAria')}>
        <Button role="tab" aria-selected={tab === 'age'} variant={tab === 'age' ? 'default' : 'outline'} onClick={() => changeTab('age')}>{t('reports.ageTab')}</Button>
        <Button role="tab" aria-selected={tab === 'margin'} variant={tab === 'margin' ? 'default' : 'outline'} onClick={() => changeTab('margin')}>{t('reports.marginTab')}</Button>
      </div>

      {tab === 'age' ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label={t('reports.ageFilterAria')}>
            <Button size="sm" variant={bucket === 'ALL' ? 'default' : 'outline'} onClick={() => { setBucket('ALL'); setPage(1) }}>{t('reports.filtersAll')}</Button>
            {ageBuckets.map((item) => {
              const count = item.value === 'over_90'
                ? ageReport.data?.summary.over_90_count ?? 0
                : ageReport.data?.summary.bucket_counts[item.value] ?? 0
              return (
                <Button key={item.value} size="sm" variant={bucket === item.value ? 'default' : 'outline'} onClick={() => { setBucket(item.value); setPage(1) }}>{item.label} ({count})</Button>
              )
            })}
            <Select value={inventoryRole} onValueChange={(value) => { setInventoryRole(value); setPage(1) }}>
              <SelectTrigger className="w-44" aria-label={t('reports.inventoryRolePlaceholder')}><SelectValue placeholder={t('reports.inventoryRolePlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('reports.inventoryRoleAll')}</SelectItem>
                <SelectItem value="USED">{t('reports.roles.USED')}</SelectItem>
                <SelectItem value="NEW">{t('reports.roles.NEW')}</SelectItem>
                <SelectItem value="DEMO">{t('reports.roles.DEMO')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stockStatus} onValueChange={(value) => { setStockStatus(value); setPage(1) }}>
              <SelectTrigger className="w-44" aria-label={t('reports.stockStatusPlaceholder')}><SelectValue placeholder={t('reports.stockStatusPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('reports.stockStatusAll')}</SelectItem>
                <SelectItem value="IN_STOCK">{t('reports.stockStatus.IN_STOCK')}</SelectItem>
                <SelectItem value="RESERVED">{t('reports.stockStatus.RESERVED')}</SelectItem>
                <SelectItem value="IN_PREP">{t('reports.stockStatus.IN_PREP')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ReportTable
            loading={isLoading}
            loadingLabel={t('reports.loadingRow')}
            headers={ageHeaders}
            rows={stockAgeTableRows.map((row) => [
              `${row.make} ${row.model} (${row.year})`, row.vin ?? emDash, row.plate ?? emDash,
              formatRole(row.inventory_role), row.stock_status ? formatStockStatus(row.stock_status) : emDash,
              row.days_in_stock === null ? t('reports.dateMissing') : t('reports.daysUnit', { count: row.days_in_stock }),
              formatMoney(row.cost_basis), formatMoney(row.asking_price), row.location ?? emDash,
            ])}
            onRowClick={(index) => navigate(`/vehicle-stock/${stockAgeTableRows[index].id}`)}
          />
          <p className="text-sm text-slate-500">
            {t('reports.over90Summary', {
              count: ageReport.data?.summary.over_90_count ?? 0,
              cost: formatMoney(ageReport.data?.summary.over_90_cost_basis ?? '0.00'),
            })}
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">{t('reports.from')}<input aria-label={t('reports.from')} type="date" className="h-10 rounded-md border px-3" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label>
            <label className="grid gap-1 text-sm">{t('reports.to')}<input aria-label={t('reports.to')} type="date" className="h-10 rounded-md border px-3" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
          </div>
          <Card><CardContent className="flex gap-8 py-4 text-sm">
            <span>{t('reports.marginTotals.sales')}: <strong>{marginReport.data?.totals.count ?? 0}</strong></span>
            <span>{t('reports.marginTotals.grossTotal', {
              known: marginReport.data?.totals.gross_margin_known_count ?? 0,
              total: marginReport.data?.totals.count ?? 0,
            })}: <strong>{formatMoney(marginReport.data?.totals.gross_margin_total ?? '0.00')}</strong></span>
            <span>{t('reports.marginTotals.grossAverage')}: <strong>{formatMoney(marginReport.data?.totals.gross_margin_average ?? null)}</strong></span>
          </CardContent></Card>
          <ReportTable
            loading={isLoading}
            loadingLabel={t('reports.loadingRow')}
            headers={marginHeaders}
            rows={marginTableRows.map((row) => [
              formatDate(row.invoice_date), row.sale_number,
              `${row.make} ${row.model} (${row.year})`, formatRole(row.inventory_role),
              formatMoney(row.sale_price), formatMoney(row.cost_basis_snapshot),
              formatMoney(row.gross_margin_eur), row.gross_margin_percent === null ? emDash : `${csvAmount(row.gross_margin_percent)}\u00a0%`,
              row.days_to_sell === null ? emDash : t('reports.daysUnit', { count: row.days_to_sell }), formatTaxMode(row.margin_taxed),
            ])}
          />
        </>
      )}

      <div className="flex items-center justify-between text-sm">
        <span>{t('reports.pageSummary', { page, total: pageCount ?? 0 })}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t('reports.paginationPrev')}</Button>
          <Button variant="outline" disabled={page >= (pageCount ?? 0)} onClick={() => setPage((current) => current + 1)}>{t('reports.paginationNext')}</Button>
        </div>
      </div>
      {isLoading ? <span className="sr-only">{t('reports.loadingSr')}</span> : null}
      {activeRows.length === 0 && !isLoading ? <p className="text-center text-sm text-slate-500">{t('reports.empty')}</p> : null}
    </div>
  )
}

function ReportTable({
  headers,
  rows,
  loading,
  loadingLabel,
  onRowClick,
}: {
  headers: string[]
  rows: string[][]
  loading: boolean
  loadingLabel: string
  onRowClick?: (index: number) => void
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td className="px-3 py-6 text-center" colSpan={headers.length}>{loadingLabel}</td></tr> : rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-t hover:bg-slate-50" onClick={() => onRowClick?.(index)}>
              {row.map((cell, cellIndex) => <td key={`${headers[cellIndex]}-${index}`} className="whitespace-nowrap px-3 py-2">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
