import type { VehicleSale } from '@/api/vehicle-stock'

type VehicleGewaehrleistungSectionProps = {
  sales: VehicleSale[]
}

function germanDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

export function VehicleGewaehrleistungSection({ sales }: VehicleGewaehrleistungSectionProps) {
  const completedSale = sales.find((sale) => sale.status !== 'DRAFT')
  const sale = completedSale

  return (
    <section aria-labelledby="gewaehrleistung-title" className="rounded-lg border p-4 space-y-2">
      <h2 id="gewaehrleistung-title" className="font-semibold">Gewährleistung</h2>
      {sale ? (
        sale.buyer_is_consumer === false ? (
          <p className="text-sm">B2B – per contract</p>
        ) : (
          <div className="space-y-1 text-sm">
            <p>Basisfrist bis {germanDate(sale.gewaehrleistung_ends_on)}</p>
            <p>Vermutungsfrist bis {germanDate(sale.presumption_ends_on)}</p>
          </div>
        )
      ) : <p className="text-sm text-slate-500">Keine abgeschlossene Fahrzeugverkaufs-Gewährleistung vorhanden.</p>}
      <p className="text-xs text-slate-500">Verlängerungen durch Reparaturen werden nicht erfasst.</p>
    </section>
  )
}
