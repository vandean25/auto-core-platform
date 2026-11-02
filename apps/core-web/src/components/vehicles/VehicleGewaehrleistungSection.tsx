import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import type { VehicleSale } from '@/api/vehicle-stock'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusBadge } from '@/components/status/StatusBadge'
import { GewaehrleistungFristen } from '@/components/vehicles/GewaehrleistungFristen'
import { gewaehrleistungStatusBadge } from '@/lib/vehicle-sale-warranty'

function GewaehrleistungRepairsInfo() {
  const { t } = useTranslation('vehicles')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-5 sm:w-5 text-slate-500 hover:text-slate-700"
          aria-label={t('gewaehrleistungSection.repairsNoteAria')}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs text-slate-600" aria-label={t('gewaehrleistungSection.repairsNoteAria')}>
        {t('gewaehrleistungSection.repairsNote')}
      </PopoverContent>
    </Popover>
  )
}

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
        <div className="flex items-center gap-1.5">
          <h2 id="gewaehrleistung-title" className="font-semibold">{t('gewaehrleistungSection.title')}</h2>
          <GewaehrleistungRepairsInfo />
        </div>
        {badge ? <StatusBadge status={badge.status} label={badge.label} /> : null}
      </div>
      {sale ? (
        sale.buyer_is_consumer === false ? (
          <p className="text-sm">{t('gewaehrleistungSection.b2b')}</p>
        ) : hasCompleteConsumerSnapshot ? (
          <GewaehrleistungFristen sale={sale} />
        ) : <p className="text-sm">{t('gewaehrleistungSection.dataUnknown')}</p>
      ) : <p className="text-sm text-slate-500">{t('gewaehrleistungSection.noSale')}</p>}
    </section>
  )
}
