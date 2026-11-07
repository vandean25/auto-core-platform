import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useVehicleStockDetail } from '@/api/vehicle-stock'
import { useCreateWorkshopOrder } from '@/api/workshop'
import { getErrorMessage } from '@/lib/error-utils'
import { StockDetailsPanel, StockLedgerPanel } from './stock-detail-panels'

export default function VehicleStockDetail() {
  const { vehicleId = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation('vehicleStock')

  useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])
  const { data: vehicle, isLoading } = useVehicleStockDetail(vehicleId)
  const createPrep = useCreateWorkshopOrder()

  if (isLoading || !vehicle) {
    return <DetailSkeleton label={t('stockDetail.loading')} />
  }

  const canSell =
    vehicle.stock_status === 'IN_STOCK' || vehicle.stock_status === 'RESERVED'
  const canPrep = canSell

  const startPrep = async () => {
    try {
      const order = await createPrep.mutateAsync({
        vehicleId,
        purpose: 'STOCK_PREP',
        odometer: vehicle.mileage ?? 0,
        fuelLevel: 50,
      })
      navigate(`/workshop/orders/${order.id}`)
    } catch (error) {
      toast.error(getErrorMessage(error, t('stockDetail.prepFailed')))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        leading={
          <Button variant="ghost" size="icon" className="max-sm:min-h-11 max-sm:min-w-11" aria-label={t('stockDetail.backAria')} onClick={() => navigate('/vehicle-stock')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {/* text-base keeps the VIN at its former size; PageHeader descriptions default to text-sm. */}
            <span className="text-base">{vehicle.vin || t('stockDetail.noVin')}</span>
            {vehicle.stock_status ? <StatusBadge status={vehicle.stock_status} /> : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="max-sm:min-h-11"
              onClick={() =>
                navigate(APP_ROUTE_PATHS.vehicleStockListing.replace(':vehicleId', vehicleId))
              }
            >
              {t('listing.title')}
            </Button>
            <Button variant="outline" className="max-sm:min-h-11" disabled={!canPrep} onClick={() => void startPrep()}>
              {t('stockDetail.stockPrep')}
            </Button>
            <Button
              className="max-sm:min-h-11"
              disabled={!canSell}
              onClick={() => navigate(`/vehicle-stock/sales/new?vehicleId=${vehicleId}`)}
            >
              {t('stockDetail.sell')}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <StockDetailsPanel vehicle={vehicle} vehicleId={vehicleId} />
        <StockLedgerPanel entries={vehicle.ledger_entries} />
      </div>
    </div>
  )
}
