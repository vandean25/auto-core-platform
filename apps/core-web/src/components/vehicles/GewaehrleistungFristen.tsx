import type { VehicleSale } from '@/api/vehicle-stock'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatWarrantyDay } from '@/lib/vehicle-sale-warranty'

type GewaehrleistungFristenSale = Pick<
  VehicleSale,
  | 'gewaehrleistung_ends_on'
  | 'presumption_ends_on'
  | 'gewaehrleistung_ends_on_expired'
  | 'presumption_ends_on_expired'
>

function ExpiredMarker({ expired }: { expired: boolean | undefined }) {
  if (!expired) return null
  return <StatusBadge status="GEWAEHRLEISTUNG_EXPIRED" label="Abgelaufen" />
}

/** The Basisfrist and Vermutungsfrist end dates; a period whose end day has passed is marked expired. */
export function GewaehrleistungFristen({ sale }: { sale: GewaehrleistungFristenSale }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        Basisfrist bis {formatWarrantyDay(sale.gewaehrleistung_ends_on)}
        <ExpiredMarker expired={sale.gewaehrleistung_ends_on_expired} />
      </p>
      <p className="flex flex-wrap items-center gap-2">
        Vermutungsfrist bis {formatWarrantyDay(sale.presumption_ends_on)}
        <ExpiredMarker expired={sale.presumption_ends_on_expired} />
      </p>
    </div>
  )
}
