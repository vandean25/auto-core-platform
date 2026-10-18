import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('vehicles')
  if (!expired) return null
  return <StatusBadge status="GEWAEHRLEISTUNG_EXPIRED" label={t('gewaehrleistungFristen.expired')} />
}

/** The Basisfrist and Vermutungsfrist end dates; a period whose end day has passed is marked expired. */
export function GewaehrleistungFristen({ sale }: { sale: GewaehrleistungFristenSale }) {
  const { t } = useTranslation('vehicles')

  return (
    <div className="space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        {t('gewaehrleistungFristen.basisfrist', { date: formatWarrantyDay(sale.gewaehrleistung_ends_on) })}
        <ExpiredMarker expired={sale.gewaehrleistung_ends_on_expired} />
      </p>
      <p className="flex flex-wrap items-center gap-2">
        {t('gewaehrleistungFristen.presumption', { date: formatWarrantyDay(sale.presumption_ends_on) })}
        <ExpiredMarker expired={sale.presumption_ends_on_expired} />
      </p>
    </div>
  )
}
