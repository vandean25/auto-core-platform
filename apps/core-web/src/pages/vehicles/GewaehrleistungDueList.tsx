import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGewaehrleistungDueList } from '@/api/vehicle-stock'
import type { VehicleGewaehrleistungDueRow } from '@/api/vehicle-stock'

const WINDOWS = [30, 60, 90] as const

function formatDate(value: string) {
  return new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function customerName(row: VehicleGewaehrleistungDueRow) {
  return row.customer.company_name || [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ')
}

export default function GewaehrleistungDueList() {
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(30)
  const { data, isLoading, isError } = useGewaehrleistungDueList(windowDays)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Gewährleistung fällig</h1>
        <p className="text-slate-500">Fahrzeugverkäufe mit bald endender Gewährleistungsfrist.</p>
      </header>
      <label className="block max-w-xs space-y-1 text-sm">
        <span>Zeitraum</span>
        <select aria-label="Zeitraum" className="h-10 w-full rounded-md border bg-background px-3" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as (typeof WINDOWS)[number])}>
          {WINDOWS.map((days) => <option key={days} value={days}>{days} Tage</option>)}
        </select>
      </label>
      {isLoading ? <p role="status">Fälligkeiten werden geladen …</p> : null}
      {isError ? <p role="alert">Gewährleistungsfälligkeiten konnten nicht geladen werden.</p> : null}
      {!isLoading && !isError && (data?.data.length ?? 0) === 0 ? <p>Keine fälligen Fahrzeuge im gewählten Zeitraum.</p> : null}
      {data?.data.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left"><th className="p-3">Fahrzeug</th><th className="p-3">Kunde</th><th className="p-3">Übergabe</th><th className="p-3">Gewährleistung bis</th><th className="p-3">Vermutungsfrist bis</th></tr></thead>
            <tbody>{data.data.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="p-3"><Link className="underline underline-offset-4" to={`/vehicles/${row.vehicle.id}`}>{row.vehicle.plate || `${row.vehicle.make} ${row.vehicle.model}`} · {row.vehicle.year}</Link></td>
                <td className="p-3">{customerName(row) || '—'}</td>
                <td className="p-3">{row.handed_over_at ? formatDate(row.handed_over_at) : '—'}</td>
                <td className="p-3">{formatDate(row.gewaehrleistung_ends_on)}</td>
                <td className="p-3">{row.presumption_ends_on ? formatDate(row.presumption_ends_on) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
