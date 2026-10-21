import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useLocations } from '@/api/locations'
import { useStockTransfer } from '@/api/stock-transfers'
import type { StockTransfer } from '@/api/stock-transfers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { StockTransferDetailHeader } from './StockTransferDetailHeader'
import { StockTransferLinesCard } from './StockTransferLinesCard'
import type { TransferAccess } from './stock-transfer-detail-logic'
import { canSubmitShip } from './stock-transfer-permissions'
import {
  useFulfilmentActions,
  useRequestActions,
  useTransferAccess,
  useTransferLabels,
  useTransferLineInputs,
} from './use-stock-transfer-detail'

interface TransferSectionProps {
  transfer: StockTransfer
  access: TransferAccess
}

function SiteSwitchHints({ transfer, access }: TransferSectionProps) {
  const { t } = useTranslation(['inventory'])

  return (
    <>
      {access.needsFromSiteForShip ? (
        <p className="text-sm text-amber-700">
          {t('inventory:stockTransfers.detail.switchToSourceSite', {
            site: transfer.fromSiteName ?? t('inventory:stockTransfers.detail.switchToSourceSiteFallback'),
          })}
        </p>
      ) : null}
      {access.needsToSiteForReceive ? (
        <p className="text-sm text-amber-700">
          {t('inventory:stockTransfers.detail.switchToDestSite', {
            site: transfer.toSiteName ?? t('inventory:stockTransfers.detail.switchToDestSiteFallback'),
          })}
        </p>
      ) : null}
    </>
  )
}

function TransferRouteCard({ transfer }: { transfer: StockTransfer }) {
  const { t } = useTranslation(['inventory'])

  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {t('inventory:stockTransfers.detail.routeTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-slate-500">{t('inventory:stockTransfers.detail.from')}</p>
          <p className="font-medium">{transfer.fromSiteName ?? transfer.fromSiteId}</p>
        </div>
        <div>
          <p className="text-slate-500">{t('inventory:stockTransfers.detail.to')}</p>
          <p className="font-medium">{transfer.toSiteName ?? transfer.toSiteId}</p>
        </div>
        {transfer.rejectReason ? (
          <div>
            <p className="text-slate-500">{t('inventory:stockTransfers.detail.rejectReason')}</p>
            <p>{transfer.rejectReason}</p>
          </div>
        ) : null}
        {transfer.cancelReason ? (
          <div>
            <p className="text-slate-500">{t('inventory:stockTransfers.detail.cancelReason')}</p>
            <p>{transfer.cancelReason}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function StockTransferDetail() {
  const { t } = useTranslation(['inventory', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const { id = '' } = useParams<{ id: string }>()
  const { data: transfer, isLoading, error } = useStockTransfer(id)
  useDocumentTitle(transfer?.transferNumber)

  const { access, memberSiteIds } = useTransferAccess(id, transfer)
  const { data: locations = [] } = useLocations({
    enabled: access.showShipControls || access.showReceiveControls,
  })
  const labels = useTransferLabels(locations)
  const inputs = useTransferLineInputs()
  const requestActions = useRequestActions(id)
  const fulfilmentActions = useFulfilmentActions(id, access, inputs)

  if (isLoading) {
    return <div className="p-8 text-center">{t('inventory:stockTransfers.detail.loading')}</div>
  }

  if (error || !transfer) {
    return <div className="p-8 text-center">{t('inventory:stockTransfers.detail.notFound')}</div>
  }

  return (
    <div className="space-y-6">
      <StockTransferDetailHeader
        transfer={transfer}
        access={access}
        shipReady={canSubmitShip(transfer, inputs.sourceLocationByLine)}
        requestActions={requestActions}
        fulfilmentActions={fulfilmentActions}
      />
      <SiteSwitchHints transfer={transfer} access={access} />
      <div className="grid gap-6 lg:grid-cols-3">
        <TransferRouteCard transfer={transfer} />
        <StockTransferLinesCard
          transfer={transfer}
          access={access}
          memberSiteIds={memberSiteIds}
          labels={labels}
          locations={locations}
          inputs={inputs}
        />
      </div>
    </div>
  )
}
