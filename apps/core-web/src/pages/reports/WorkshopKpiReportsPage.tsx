import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthSession } from '@/api/auth-session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport, type WorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { triggerBlobDownload } from '@/lib/download'

function number(value: string | null | undefined, suffix = ''): string {
  return value == null ? '—' : `${Number(value).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
}

function csvField(value: string): string {
  const safe = /^[=+@-]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function serializeWorkshopKpiCsv(report: WorkshopKpiReport): string {
  const headers = [
    'Datentyp', 'Mechaniker', 'Zeitraum', 'Verfügbare Stunden', 'Gebuchte Stunden',
    'Fakturierte Stunden', 'Nettoerlös Arbeit (EUR)', 'Nettoerlös Teile (EUR)',
    'Auslastung (%)', 'Leistungsgrad (%)', 'Abgeschlossene Aufträge',
    'Nettoerlös je Auftrag (EUR)', 'Offene Zeiteinträge', 'Verbrauchskosten (EUR)',
    'Durchschnittlicher Lagerwert (EUR)', 'Lagerumschlag',
    'Nicht bewertete Lagerpositionen', 'Artikel-SKU', 'Artikel', 'Menge',
    'Lagerwert (EUR)', 'Tage seit Verbrauch', 'Standortzeitzone', 'Gruppierung',
    'Mechaniker ohne Standortzuordnung',
  ]
  const emptyWorkMetrics = ['', '', '', '', '', '', '', '', '', '']
  const emptyTurnoverMetrics = ['', '', '', '']
  const emptySlowMoverDetails = ['', '', '', '', '']
  const dateRange = `${report.meta.from}–${report.meta.to}`
  const workRows = [...report.data, report.totals].map((row) => [
    'Arbeitsleistung', row.mechanic_name ?? 'Gesamt', row.period,
    row.available_hours, row.clocked_hours, row.sold_hours,
    row.labor_net_revenue, row.parts_net_revenue, row.utilisation_percent ?? '',
    row.productivity_percent ?? '', String(row.closed_orders),
    row.average_net_revenue_per_order ?? '', String(row.open_labor_entry_count),
    ...emptyTurnoverMetrics, ...emptySlowMoverDetails, '', '', '',
  ])
  const turnoverRow = [
    'Lagerumschlag', '', dateRange, ...emptyWorkMetrics,
    report.parts_turnover.issued_cost,
    report.parts_turnover.average_stock_value ?? '',
    report.parts_turnover.turnover ?? '',
    String(report.parts_turnover.unvalued_stock_item_count),
    ...emptySlowMoverDetails, '', '', '',
  ]
  const slowMoverRows = report.parts_turnover.slow_movers.map((part) => [
    'Langsamläufer', '', dateRange, ...emptyWorkMetrics, ...emptyTurnoverMetrics,
    part.sku, part.name, part.quantity_on_hand, part.stock_value ?? '',
    part.days_since_last_issue === null ? 'Nie' : String(part.days_since_last_issue),
    '', '', '',
  ])
  const reportInfoRow = [
    'Berichtsinfo', '', dateRange, ...emptyWorkMetrics, ...emptyTurnoverMetrics,
    ...emptySlowMoverDetails, report.meta.timezone, report.meta.groupBy,
    String(report.meta.unassigned_mechanic_count),
  ]

  return [headers, ...workRows, turnoverRow, ...slowMoverRows, reportInfoRow]
    .map((line) => line.map(csvField).join(';'))
    .join('\r\n')
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

  const exportCsv = () => {
    if (!report.data) return
    triggerBlobDownload(new Blob(['\uFEFF', serializeWorkshopKpiCsv(report.data)], { type: 'text/csv;charset=utf-8' }), 'workshop-kpis.csv')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">Workshop-KPIs</h1><p className="text-slate-500">Auslastung, Leistungsgrad und Lagerumschlag.</p></div>
        <Button onClick={exportCsv} disabled={!report.data}><Download className="mr-2 h-4 w-4" />CSV exportieren</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1 text-sm"><label htmlFor="workshop-report-site">Standort</label><Select value={selectedSiteId} onValueChange={setSiteId}><SelectTrigger id="workshop-report-site" className="w-52"><SelectValue placeholder="Standort wählen" /></SelectTrigger><SelectContent>{(sites.data ?? []).map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1 text-sm"><label htmlFor="workshop-report-from">Von</label><input id="workshop-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-md border px-3" /></div>
        <div className="grid gap-1 text-sm"><label htmlFor="workshop-report-to">Bis</label><input id="workshop-report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-md border px-3" /></div>
        <div className="grid gap-1 text-sm"><label htmlFor="workshop-report-group">Gruppierung</label><Select value={groupBy} onValueChange={(value) => setGroupBy(value as typeof groupBy)}><SelectTrigger id="workshop-report-group" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mechanic">Mechaniker</SelectItem><SelectItem value="week">Woche</SelectItem><SelectItem value="month">Monat</SelectItem></SelectContent></Select></div>
      </div>
      {report.isError && <p role="alert" className="text-sm text-red-600">{report.error.message}</p>}
      <Card><CardHeader><CardTitle>Arbeitsleistung</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <table className="w-full text-sm"><thead><tr className="border-b text-left">{['Mechaniker', 'Zeitraum', 'Verfügbar', 'Gebucht', 'Fakturiert', 'Arbeit netto', 'Teile netto', 'Auslastung', 'Leistungsgrad', 'Aufträge', 'Ø Netto/Auftrag', 'Offene Zeiten'].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead>
          <tbody>{report.isLoading ? <tr><td className="p-4" colSpan={12}>Bericht wird geladen …</td></tr> : visibleRows.length ? [...visibleRows, ...(report.data ? [report.data.totals] : [])].map((row) => <tr key={row.key} className="border-b"><td className="p-2">{row.mechanic_name ?? 'Gesamt'}</td><td className="p-2">{row.period}</td><td className="p-2">{number(row.available_hours)}</td><td className="p-2">{number(row.clocked_hours)}</td><td className="p-2">{number(row.sold_hours)}</td><td className="p-2">{number(row.labor_net_revenue, ' €')}</td><td className="p-2">{number(row.parts_net_revenue, ' €')}</td><td className="p-2">{number(row.utilisation_percent, ' %')}</td><td className="p-2">{number(row.productivity_percent, ' %')}</td><td className="p-2">{row.closed_orders}</td><td className="p-2">{number(row.average_net_revenue_per_order, ' €')}</td><td className="p-2">{row.open_labor_entry_count}</td></tr>) : <tr><td className="p-4 text-slate-500" colSpan={12}>Keine Daten für den ausgewählten Zeitraum.</td></tr>}</tbody>
        </table>
        {report.data && <p className="mt-3 text-xs text-slate-500">Zeitzone: {report.data.meta.timezone}. {report.data.meta.unassigned_mechanic_count} Mechaniker ohne gültige Standortzuordnung.</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Lagerumschlag</CardTitle></CardHeader><CardContent>
        <p>Verbrauchskosten: {number(report.data?.parts_turnover.issued_cost, ' €')} · Ø Lagerwert: {number(report.data?.parts_turnover.average_stock_value, ' €')} · Umschlag: {number(report.data?.parts_turnover.turnover, '×')}</p>
        <p className="mt-1 text-xs text-slate-500">Nicht bewertete Lagerpositionen: {report.data?.parts_turnover.unvalued_stock_item_count ?? 0}</p>
        <h3 className="mb-2 mt-5 text-sm font-semibold">Teile ohne Werkstattverbrauch in den letzten 90 Tagen</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Artikel</th><th className="p-2">Menge</th><th className="p-2">Lagerwert</th><th className="p-2">Tage seit Verbrauch</th></tr></thead>
          <tbody>{report.data?.parts_turnover.slow_movers.length ? report.data.parts_turnover.slow_movers.map((part) => <tr key={part.catalog_item_id} className="border-b"><td className="p-2">{part.sku} · {part.name}</td><td className="p-2">{Number(part.quantity_on_hand).toLocaleString('de-AT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td><td className="p-2">{number(part.stock_value, ' €')}</td><td className="p-2">{part.days_since_last_issue ?? 'Nie'}</td></tr>) : <tr><td className="p-3 text-slate-500" colSpan={4}>Keine passenden Teile im Bestand.</td></tr>}</tbody>
        </table></div>
      </CardContent></Card>
    </div>
  )
}
