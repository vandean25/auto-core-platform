import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useVehicleStockAgeReport, useVehicleStockMarginReport, type VehicleStockAgeBucket, type VehicleStockAgeReportRow, type VehicleStockMarginReportRow } from '@/api/vehicle-stock'
import { triggerBlobDownload } from '@/lib/download'

type ReportTab = 'age' | 'margin'

const AGE_BUCKETS = [
  { value: '0_30', label: '0–30 Tage' },
  { value: '31_60', label: '31–60 Tage' },
  { value: '61_90', label: '61–90 Tage' },
  { value: '91_180', label: '91–180 Tage' },
  { value: 'over_180', label: 'Über 180 Tage' },
  { value: 'over_90', label: 'Über 90 Tage' },
] as const

function safeCsvField(value: string): string {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue
}

function csvAmount(value: string | null): string {
  return value ? value.replace('.', ',') : ''
}

export function serializeStockAgeCsv(rows: VehicleStockAgeReportRow[]): string {
  const header = ['Marke', 'Modell', 'Baujahr', 'FIN', 'Kennzeichen', 'Bestandsrolle', 'Status', 'Standzeit (Tage)', 'Kostenbasis (EUR)', 'Angebotspreis (EUR)', 'Standort']
  const body = rows.map((row) => [
    row.make, row.model, String(row.year), row.vin ?? '', row.plate ?? '', row.inventory_role,
    row.stock_status ?? '', row.days_in_stock === null ? '' : String(row.days_in_stock),
    csvAmount(row.cost_basis), csvAmount(row.asking_price), row.location ?? '',
  ])
  return [header, ...body].map((line) => line.map(safeCsvField).join(';')).join('\r\n')
}

export function serializeMarginCsv(rows: VehicleStockMarginReportRow[]): string {
  const header = ['Rechnungsdatum', 'Verkaufsnummer', 'Marke', 'Modell', 'Baujahr', 'Bestandsrolle', 'Nettoverkaufspreis (EUR)', 'Kostenbasis (EUR)', 'Rohertrag (EUR)', 'Rohertrag (%)', 'Standzeit bis Verkauf (Tage)', 'Margenbesteuerung']
  const body = rows.map((row) => [
    new Date(row.invoice_date).toLocaleDateString('de-AT'), row.sale_number, row.make, row.model,
    String(row.year), row.inventory_role, csvAmount(row.sale_price),
    csvAmount(row.cost_basis_snapshot), csvAmount(row.gross_margin_eur),
    csvAmount(row.gross_margin_percent), row.days_to_sell === null ? '' : String(row.days_to_sell),
    row.margin_taxed ? 'Ja' : 'Nein',
  ])
  return [header, ...body].map((line) => line.map(safeCsvField).join(';')).join('\r\n')
}

function downloadCsv(content: string, filename: string) {
  triggerBlobDownload(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }), filename)
}

function formatRole(role: string) {
  return ({ USED: 'Gebraucht', NEW: 'Neu', DEMO: 'Vorführwagen' } as Record<string, string>)[role] ?? role
}

function formatMoney(value: string | null) {
  return value === null ? '—' : `${csvAmount(value)}\u00a0€`
}

export default function VehicleStockReportsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<ReportTab>('age')
  const [bucket, setBucket] = useState(searchParams.get('bucket') ?? 'ALL')
  const [inventoryRole, setInventoryRole] = useState('ALL')
  const [stockStatus, setStockStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fahrzeugbestand Berichte</h1>
          <p className="text-slate-500">Standzeit und Rohertrag des Händlerbestands.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/vehicle-stock')}>Bestand</Button>
          <Button onClick={() => downloadCsv(
            tab === 'age' ? serializeStockAgeCsv(stockAgeTableRows) : serializeMarginCsv(marginTableRows),
            tab === 'age' ? 'fahrzeugbestand-standzeit.csv' : 'fahrzeugbestand-rohertrag.csv',
          )}>
            <Download className="mr-2 h-4 w-4" /> CSV exportieren
          </Button>
        </div>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Fahrzeugbestand Berichte">
        <Button role="tab" aria-selected={tab === 'age'} variant={tab === 'age' ? 'default' : 'outline'} onClick={() => changeTab('age')}>Standzeit</Button>
        <Button role="tab" aria-selected={tab === 'margin'} variant={tab === 'margin' ? 'default' : 'outline'} onClick={() => changeTab('margin')}>Rohertrag</Button>
      </div>

      {tab === 'age' ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Standzeitfilter">
            <Button size="sm" variant={bucket === 'ALL' ? 'default' : 'outline'} onClick={() => { setBucket('ALL'); setPage(1) }}>Alle</Button>
            {AGE_BUCKETS.map((item) => (
              <Button key={item.value} size="sm" variant={bucket === item.value ? 'default' : 'outline'} onClick={() => { setBucket(item.value); setPage(1) }}>{item.label}</Button>
            ))}
            <Select value={inventoryRole} onValueChange={(value) => { setInventoryRole(value); setPage(1) }}>
              <SelectTrigger className="w-44" aria-label="Bestandsrolle"><SelectValue placeholder="Bestandsrolle" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Alle Rollen</SelectItem>
                <SelectItem value="USED">Gebraucht</SelectItem>
                <SelectItem value="NEW">Neu</SelectItem>
                <SelectItem value="DEMO">Vorführwagen</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stockStatus} onValueChange={(value) => { setStockStatus(value); setPage(1) }}>
              <SelectTrigger className="w-44" aria-label="Bestandsstatus"><SelectValue placeholder="Bestandsstatus" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Alle Status</SelectItem>
                <SelectItem value="IN_STOCK">Auf Lager</SelectItem>
                <SelectItem value="RESERVED">Reserviert</SelectItem>
                <SelectItem value="IN_PREP">In Aufbereitung</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ReportTable
            loading={isLoading}
            headers={['Fahrzeug', 'FIN', 'Kennzeichen', 'Rolle', 'Status', 'Standzeit', 'Kostenbasis', 'Angebotspreis', 'Standort']}
            rows={stockAgeTableRows.map((row) => [
              `${row.make} ${row.model} (${row.year})`, row.vin ?? '—', row.plate ?? '—',
              formatRole(row.inventory_role), row.stock_status ?? '—',
              row.days_in_stock === null ? 'Datum fehlt' : `${row.days_in_stock} Tage`,
              formatMoney(row.cost_basis), formatMoney(row.asking_price), row.location ?? '—',
            ])}
            onRowClick={(index) => navigate(`/vehicle-stock/${stockAgeTableRows[index].id}`)}
          />
          <p className="text-sm text-slate-500">Über 90 Tage: {ageReport.data?.summary.over_90_count ?? 0} Fahrzeuge · Kostenbasis {formatMoney(ageReport.data?.summary.over_90_cost_basis ?? '0.00')}</p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">Von<input aria-label="Von" type="date" className="h-10 rounded-md border px-3" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label>
            <label className="grid gap-1 text-sm">Bis<input aria-label="Bis" type="date" className="h-10 rounded-md border px-3" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
          </div>
          <Card><CardContent className="flex gap-8 py-4 text-sm">
            <span>Verkäufe: <strong>{marginReport.data?.totals.count ?? 0}</strong></span>
            <span>Rohertrag gesamt: <strong>{formatMoney(marginReport.data?.totals.gross_margin_total ?? '0.00')}</strong></span>
            <span>Rohertrag Ø: <strong>{formatMoney(marginReport.data?.totals.gross_margin_average ?? null)}</strong></span>
          </CardContent></Card>
          <ReportTable
            loading={isLoading}
            headers={['Rechnungsdatum', 'Verkaufsnummer', 'Fahrzeug', 'Rolle', 'Nettoverkauf', 'Kostenbasis', 'Rohertrag', 'Rohertrag %', 'Standzeit', 'Besteuerung']}
            rows={marginTableRows.map((row) => [
              new Date(row.invoice_date).toLocaleDateString('de-AT'), row.sale_number,
              `${row.make} ${row.model} (${row.year})`, formatRole(row.inventory_role),
              formatMoney(row.sale_price), formatMoney(row.cost_basis_snapshot),
              formatMoney(row.gross_margin_eur), row.gross_margin_percent === null ? '—' : `${csvAmount(row.gross_margin_percent)}\u00a0%`,
              row.days_to_sell === null ? '—' : `${row.days_to_sell} Tage`, row.margin_taxed ? 'Marge' : 'Standard',
            ])}
          />
        </>
      )}

      <div className="flex items-center justify-between text-sm">
        <span>Seite {page} von {pageCount ?? 0}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Zurück</Button>
          <Button variant="outline" disabled={page >= (pageCount ?? 0)} onClick={() => setPage((current) => current + 1)}>Weiter</Button>
        </div>
      </div>
      {isLoading ? <span className="sr-only">Bericht wird geladen</span> : null}
      {activeRows.length === 0 && !isLoading ? <p className="text-center text-sm text-slate-500">Keine Fahrzeuge für diese Auswahl.</p> : null}
    </div>
  )
}

function ReportTable({
  headers,
  rows,
  loading,
  onRowClick,
}: {
  headers: string[]
  rows: string[][]
  loading: boolean
  onRowClick?: (index: number) => void
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td className="px-3 py-6 text-center" colSpan={headers.length}>Lädt …</td></tr> : rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-t hover:bg-slate-50" onClick={() => onRowClick?.(index)}>
              {row.map((cell, cellIndex) => <td key={`${headers[cellIndex]}-${index}`} className="whitespace-nowrap px-3 py-2">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
