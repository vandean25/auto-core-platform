import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { VehicleSale, VehicleStockDetail } from '@/api/vehicle-stock'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_STATUS_CLASS: Record<Exclude<SaveStatus, 'idle'>, string> = {
  saving: 'text-slate-500',
  saved: 'text-emerald-600',
  error: 'text-rose-600',
}

/** Top-left context: back link, title, vehicle, status and the invoice of the sale. */
export function VehicleSaleTitle({
  vehicleId,
  vehicle,
  sale,
}: {
  vehicleId: string
  vehicle: VehicleStockDetail | undefined
  sale: VehicleSale | undefined
}) {
  const { t } = useTranslation('vehicleStock')
  const navigate = useNavigate()
  return (
    <div className="flex items-center gap-4">
      <Button
        variant="ghost"
        size="icon"
        aria-label={vehicleId ? t('sale.backToVehicleAria') : t('sale.backAria')}
        onClick={() => navigate(vehicleId ? `/vehicle-stock/${vehicleId}` : '/vehicle-stock')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('sale.title')}</h1>
        <p className="text-slate-500">
          {vehicle
            ? t('sale.vehicleSummary', {
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                taxMode: t('sale.subtitleMargin'),
              })
            : t('sale.subtitleFallback')}
        </p>
      </div>
      {sale ? <StatusBadge status={sale.status} /> : null}
      {sale?.invoice ? (
        <Link
          to={`/sales/invoices/${sale.invoice.id}`}
          className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
        >
          {sale.invoice.invoice_number
            ? t('sale.invoiceLink', { number: sale.invoice.invoice_number })
            : t('sale.openInvoice')}
        </Link>
      ) : null}
    </div>
  )
}

/** Top-right actions: autosave status, Kaufvertrag PDF and invoicing. */
export function VehicleSaleActions({
  saleId,
  saveStatus,
  isDraft,
  isCancelled,
  isFinalizing,
  isDownloading,
  onDownload,
  onFinalize,
}: {
  saleId: string
  saveStatus: SaveStatus
  isDraft: boolean
  isCancelled: boolean
  isFinalizing: boolean
  isDownloading: boolean
  onDownload: () => void
  onFinalize: () => void
}) {
  const { t } = useTranslation('vehicleStock')
  const saveStatusLabel = {
    saving: t('sale.saveStatus.saving'),
    saved: t('sale.saveStatus.saved'),
    error: t('sale.saveStatus.error'),
  }
  return (
    <div className="flex items-center gap-3">
      {saveStatus === 'idle' ? null : (
        <span className={`text-sm ${SAVE_STATUS_CLASS[saveStatus]}`}>{saveStatusLabel[saveStatus]}</span>
      )}
      <Button
        variant="outline"
        disabled={!saleId || isFinalizing || isDownloading || saveStatus === 'saving' || isCancelled}
        onClick={onDownload}
      >
        <Download className="mr-2 h-4 w-4" />
        {t('sale.downloadKaufvertrag')}
      </Button>
      <Button
        disabled={!saleId || !isDraft || isFinalizing || saveStatus === 'saving'}
        onClick={onFinalize}
      >
        {t('sale.finalizeInvoice')}
      </Button>
    </div>
  )
}
