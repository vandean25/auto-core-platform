import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useCreatePO } from '@/api/purchase-orders'
import type { PurchaseOrder } from '@/api/types'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'

export type PurchaseOrderCreateRequest = {
  vendorId: string
  vendorName: string
}

let queuedCreate: PurchaseOrderCreateRequest | null = null

/** Hands the wizard's create to the list. One slot: a second handoff replaces a create the list has not taken. */
export function queuePurchaseOrderCreate(request: PurchaseOrderCreateRequest) {
  queuedCreate = request
}

export function takeQueuedPurchaseOrderCreate() {
  const request = queuedCreate
  queuedCreate = null
  return request
}

function buildPendingOrder(localId: string, payload: PurchaseOrderCreateRequest): PurchaseOrder {
  return {
    id: localId,
    vendor_id: payload.vendorId,
    vendor: {
      id: payload.vendorId,
      name: payload.vendorName,
      email: '',
      account_number: '',
      createdAt: '',
      updatedAt: '',
    },
    status: 'DRAFT',
    order_number: '',
    items: [],
    createdAt: '',
  }
}

/** Purchase-order create stays server-confirmed behind a pending list row (ADR-0036 R1). */
export function usePurchaseOrderPendingCreate(serverRows: PurchaseOrder[], dataUpdatedAt: number) {
  const { t } = useTranslation('finance')
  const navigate = useNavigate()
  const createOrder = useCreatePO()
  const pending = useListPendingCreate<PurchaseOrderCreateRequest, PurchaseOrder>({
    create: (payload) => createOrder.mutateAsync({ vendorId: payload.vendorId, items: [] }),
    buildRow: buildPendingOrder,
    serverRows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, {
        unconfirmed: t('purchaseOrders.create.createUnconfirmed'),
        failed: t('purchaseOrders.create.createFailed'),
      }),
    onCreated: (created) => {
      toast.success(t('purchaseOrders.create.created'))
      navigate(`/purchase-orders/${created.id}`)
    },
  })

  const { submit } = pending
  useEffect(() => {
    const request = takeQueuedPurchaseOrderCreate()
    if (request) submit(request)
  }, [submit])

  return pending
}
