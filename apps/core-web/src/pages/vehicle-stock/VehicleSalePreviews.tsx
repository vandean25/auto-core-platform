import { useTranslation } from 'react-i18next'
import type { VehicleSale, VehicleStockDetail } from '@/api/vehicle-stock'
import { formatCurrency } from '@/lib/utils'
import { NovaPreviewPanel } from '@/components/vehicles/NovaPreviewPanel'

/** Cost basis, margin VAT and tax mode the invoice will use. */
export function VehicleSaleTaxPreview({
  sale,
  vehicle,
}: {
  sale: VehicleSale | undefined
  vehicle: VehicleStockDetail | undefined
}) {
  const { t } = useTranslation('vehicleStock')
  const emDash = t('shared.emDash')
  const vatPreview = sale?.margin_vat_preview
  const costPreview = sale?.cost_basis_preview ?? vehicle?.cost_basis
  return (
    <div className="rounded-lg border p-4 grid gap-3 md:grid-cols-3">
      <div>
        <div className="text-xs text-slate-500">{t('sale.preview.costBasis')}</div>
        <div className="font-medium">
          {costPreview != null ? formatCurrency(costPreview) : emDash}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500">{t('sale.preview.marginVat')}</div>
        <div className="font-medium">
          {vatPreview != null ? formatCurrency(vatPreview) : emDash}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500">{t('sale.preview.taxMode')}</div>
        <div className="font-medium">{t('sale.preview.taxModeMarginScheme')}</div>
      </div>
    </div>
  )
}

/** The saved trade-in with its allowance and what the buyer still owes. */
export function VehicleSaleTradeInSummary({ sale }: { sale: VehicleSale | undefined }) {
  const { t } = useTranslation('vehicleStock')
  if (!sale?.trade_in_purchase) return null
  const tradeIn = sale.trade_in_purchase
  return (
    <div className="rounded-lg border p-4 grid gap-3 md:grid-cols-3">
      <div>
        <div className="text-xs text-slate-500">{t('sale.tradeIn.vehicle')}</div>
        <div className="font-medium">
          {`${tradeIn.year} ${tradeIn.make} ${tradeIn.model}`}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500">{t('sale.tradeIn.allowance')}</div>
        <div className="font-medium">{formatCurrency(tradeIn.purchase_price)}</div>
      </div>
      <div>
        <div className="text-xs text-slate-500">{t('sale.tradeIn.amountDue')}</div>
        <div className="font-medium">
          {sale.amount_due_preview != null ? formatCurrency(sale.amount_due_preview) : t('shared.emDash')}
        </div>
      </div>
    </div>
  )
}

/** NoVA preview for the stock vehicle; the panel needs explicit nulls for unknown vehicle data. */
export function VehicleSaleNovaPreview({ vehicle }: { vehicle: VehicleStockDetail | undefined }) {
  if (!vehicle) return null
  return (
    <NovaPreviewPanel
      vehicleId={vehicle.id}
      firstRegistrationDate={vehicle.first_registration_date ?? null}
      co2Wltp={vehicle.co2_wltp_g_km ?? null}
      co2Nedc={vehicle.co2_nedc_g_km ?? null}
      typenscheinNo={vehicle.typenschein_no ?? null}
      novaClass={vehicle.nova_class ?? null}
    />
  )
}
