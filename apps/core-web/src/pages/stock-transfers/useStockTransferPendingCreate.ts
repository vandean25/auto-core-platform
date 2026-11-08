import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useCreateStockTransfer, type CreateStockTransferPayload, type StockTransfer } from '@/api/stock-transfers'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'

export type StockTransferCreateRequest = CreateStockTransferPayload & {
  fromSiteName: string
  toSiteName: string
}

/** Site names the user picked. No transfer number, quantity or status. */
function buildPendingTransfer(localId: string, payload: StockTransferCreateRequest): StockTransfer {
  return {
    id: localId,
    transferNumber: '',
    fromSiteId: payload.fromSiteId,
    fromSiteName: payload.fromSiteName,
    toSiteId: payload.toSiteId,
    toSiteName: payload.toSiteName,
    status: 'REQUESTED',
    version: 0,
    requestedByUserId: '',
    approvedByUserId: null,
    shippedByUserId: null,
    receivedByUserId: null,
    rejectReason: null,
    cancelReason: null,
    createdAt: '',
    updatedAt: '',
    lines: [],
  }
}

/** Transfer create stays server-confirmed behind a pending list row (ADR-0036 R1). */
export function useStockTransferPendingCreate(serverRows: StockTransfer[], dataUpdatedAt: number) {
  const { t } = useTranslation('inventory')
  const navigate = useNavigate()
  const createTransfer = useCreateStockTransfer()
  return useListPendingCreate<StockTransferCreateRequest, StockTransfer>({
    create: (request) =>
      createTransfer.mutateAsync({
        fromSiteId: request.fromSiteId,
        toSiteId: request.toSiteId,
        lines: request.lines,
      }),
    buildRow: buildPendingTransfer,
    serverRows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, {
        unconfirmed: t('stockTransfers.create.createUnconfirmed'),
        failed: t('stockTransfers.create.failed'),
      }),
    onCreated: (created) => {
      toast.success(t('stockTransfers.create.success'))
      navigate(`/stock-transfers/${created.id}`)
    },
  })
}
