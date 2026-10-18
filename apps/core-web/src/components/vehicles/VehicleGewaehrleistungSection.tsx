import { useTranslation } from 'react-i18next'
import type { VehicleSale } from '@/api/vehicle-stock'
import { StatusBadge } from '@/components/status/StatusBadge'
import { GewaehrleistungFristen } from '@/components/vehicles/GewaehrleistungFristen'
import { gewaehrleistungStatusBadge } from '@/lib/vehicle-sale-warranty'

type VehicleGewaehrleistungSectionProps = {
  sales: VehicleSale[]
}

export function VehicleGewaehrleistungSection({ sales }: VehicleGewaehrleistungSectionProps) {
  const { t } = useTranslation('vehicles')
  const sale = sales.find((item) => item.status !== 'DRAFT')
  const hasCompleteConsumerSnapshot = Boolean(
    sale?.buyer_is_consumer === true &&
    sale.gewaehrleistung_ends_on &&
    sale.presumption_ends_on,
  )
  const badge = sale?.gewaehrleistung_status ? gewaehrleistungStatusBadge(sale.gewaehrleistung_status) : null

  return (
    <section aria-labelledby="gewaehrleistung-title" className="rounded-lg border p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gewaehrleistung-title" className="font-semibold">{t('gewaehrleistungSection.title')}</h2>
        {badge ? <StatusBadge status={badge.status} label={badge.label} /> : null}
      </div>
      {sale ? (
        sale.buyer_is_consumer === false ? (
          <p className="text-sm">{t('gewaehrleistungSection.b2b')}</p>
        ) : hasCompleteConsumerSnapshot ? (
          <GewaehrleistungFristen sale={sale} />
        ) : <p className="text-sm">{t('gewaehrleistungSection.dataUnknown')}</p>
      ) : <p className="text-sm text-slate-500">{t('gewaehrleistungSection.noSale')}</p>}
      <p className="text-xs text-slate-500">{t('gewaehrleistungSection.repairsNote')}</p>
    </section>
  )
}
