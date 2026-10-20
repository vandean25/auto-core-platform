import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { useParams, useSearchParams } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import {
  VehicleSaleTradeInSection,
  type VehicleSaleTradeInHandle,
} from '@/components/vehicle-stock/VehicleSaleTradeInSection'
import { useVehicleSale, useVehicleStockDetail } from '@/api/vehicle-stock'
import type { Customer } from '@/api/types'
import { useVehicleSaleForm } from './useVehicleSaleForm'
import { useVehicleSaleAutosave } from './useVehicleSaleAutosave'
import { useVehicleSaleInvoicing } from './useVehicleSaleInvoicing'
import { useKaufvertragDownload } from './useKaufvertragDownload'
import { VehicleSaleActions, VehicleSaleTitle } from './VehicleSaleHeader'
import { VehicleSaleWarrantySection } from './VehicleSaleWarrantySection'
import {
  VehicleSaleNovaPreview,
  VehicleSaleTaxPreview,
  VehicleSaleTradeInSummary,
} from './VehicleSalePreviews'

/** The sale from the route (`new` until it is created) and the stock vehicle it sells. */
function useVehicleSaleRecord() {
  const { id = 'new' } = useParams()
  const [searchParams] = useSearchParams()
  const { data: existing } = useVehicleSale(id)
  const vehicleId = existing?.vehicle_id || (searchParams.get('vehicleId') ?? '')
  const { data: vehicle } = useVehicleStockDetail(vehicleId)
  return { id, existing, vehicleId, vehicle }
}

export default function VehicleSalePage() {
  const { t } = useTranslation('vehicleStock')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])
  const { id, existing, vehicleId, vehicle } = useVehicleSaleRecord()
  const form = useVehicleSaleForm(existing, vehicleId)
  const invoicing = useVehicleSaleInvoicing()
  const isDraft = !existing || existing.status === 'DRAFT'
  const locked = !isDraft || invoicing.isFinalizing
  const draft = useVehicleSaleAutosave({
    routeSaleId: id,
    existing,
    facts: form.facts,
    enabled: !locked && form.hasRequiredFacts && form.garantie.valid,
  })
  const kaufvertrag = useKaufvertragDownload({ sale: existing, draft, form, isDraft })
  const tradeInRef = useRef<VehicleSaleTradeInHandle>(null)

  const handleCustomerChange = (nextCustomer: Customer | null) => {
    if (invoicing.finalizingRef.current) return
    form.selectCustomer(nextCustomer)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <VehicleSaleTitle vehicleId={vehicleId} vehicle={vehicle} sale={existing} />
        <VehicleSaleActions
          saleId={draft.saleId}
          saveStatus={draft.saveStatus}
          isDraft={isDraft}
          isCancelled={existing?.status === 'CANCELLED'}
          isFinalizing={invoicing.isFinalizing}
          isDownloading={kaufvertrag.isDownloadingKaufvertrag}
          onDownload={() => void kaufvertrag.downloadKaufvertragPdf()}
          onFinalize={() => void invoicing.finalize(draft, tradeInRef)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1 text-sm">
            <span className="text-slate-500">{t('sale.buyer')}</span>
            <CustomerSearch value={form.customer} onChange={handleCustomerChange} />
          </div>
          <VehicleSaleTradeInSection
            ref={tradeInRef}
            saleId={draft.saleId}
            salePrice={form.priceNumber}
            purchase={existing?.trade_in_purchase ?? null}
            editable={!locked}
          />
        </div>
        <div className="space-y-4">
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">{t('sale.salePriceGross')}</span>
            <Input
              disabled={locked}
              type="number"
              value={form.salePrice}
              onChange={(event) => form.setSalePrice(event.target.value)}
            />
          </label>
          <VehicleSaleWarrantySection
            form={form}
            sale={existing}
            vehicle={vehicle}
            locked={locked}
            shorteningSaveError={draft.shorteningSaveError}
            clearShorteningSaveError={() => draft.setShorteningSaveError(null)}
          />
          <VehicleSaleNovaPreview vehicle={vehicle} />
        </div>
      </div>

      <VehicleSaleTaxPreview sale={existing} vehicle={vehicle} />
      <VehicleSaleTradeInSummary sale={existing} />
    </div>
  )
}
