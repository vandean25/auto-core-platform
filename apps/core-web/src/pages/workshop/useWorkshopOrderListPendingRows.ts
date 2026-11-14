import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useCreateWorkshopOrder } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import {
  createPendingWorkshopOrder,
  type PendingOrderFailure,
  type WorkshopOrderListPendingRow,
} from '@/components/workshop/workshop-order-intake-create'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import { useRetainedQueryData } from '@/hooks/useRetainedQueryData'
import { formatDate } from '@/lib/format'

/**
 * `orders` are the server rows of the active list mode (offset page or loaded infinite blocks). The infinite list
 * never refetches after a create (it offers "Liste aktualisieren" instead), so there a settled row goes at once.
 */
export function useWorkshopOrderListRows(
  orders: WorkshopOrder[] | undefined,
  isError: boolean,
  dataUpdatedAt = 0,
  infinite = false,
) {
  const retained = useRetainedQueryData(orders)
  const visibleOrders = retained.data
  const loadedRows = useMemo<WorkshopOrderListRow[]>(() => {
    const source = visibleOrders ?? []
    return source.map((order) => ({
      id: order.id,
      orderNo: order.order_number ?? order.id,
      customer: getWorkshopCustomerDisplayName(order),
      vehicle: `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`,
      openedAt: formatDate(order.createdAt),
      status: order.status,
    }))
  }, [visibleOrders])
  const pending = useWorkshopOrderListPendingRows(loadedRows, dataUpdatedAt, infinite)
  return {
    /** Server rows only. Row actions and shortcuts must never see the client-side ids of pending rows. */
    loadedRows,
    showingStaleError: isError && retained.isRetained,
    ...pending,
  }
}

type PendingSettlement = {
  serverOrderId: string
  /** Wall-clock time the create settled. The row goes once the orders query holds data fetched after it. */
  settledAt: number
}

function useWorkshopOrderListPendingRows(loadedRows: WorkshopOrderListRow[], dataUpdatedAt: number, infinite: boolean) {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const createOrder = useCreateWorkshopOrder()
  const [pendingRows, setPendingRows] = useState<WorkshopOrderListPendingRow[]>([])
  const [settled, setSettled] = useState<Record<string, PendingSettlement>>({})
  const retrying = useRef(new Set<string>())

  const tableRows = useMemo(() => {
    const stillPending = pendingRows.filter((pending) => {
      const settlement = settled[pending.id]
      if (!settlement) return true
      if (infinite) return false
      if (loadedRows.some((row) => row.id === settlement.serverOrderId)) return false
      // shortcut: millisecond clock, a refetch landing in the same ms as the settle keeps the row until the next fetch.
      return dataUpdatedAt <= settlement.settledAt
    })
    return [...stillPending, ...loadedRows]
  }, [dataUpdatedAt, infinite, loadedRows, pendingRows, settled])

  const onPendingOrder = useCallback((row: WorkshopOrderListPendingRow) => {
    setPendingRows((previous) => [row, ...previous.filter((existing) => existing.id !== row.id)])
  }, [])
  const onPendingOrderSettled = useCallback((localId: string, serverOrderId: string) => {
    setSettled((previous) => ({
      ...previous,
      [localId]: { serverOrderId, settledAt: Date.now() },
    }))
  }, [])
  const onPendingOrderFailed = useCallback((localId: string, failure: PendingOrderFailure) => {
    setPendingRows((previous) =>
      previous.map((row) => (row.id === localId ? { ...row, pendingFailure: failure } : row)),
    )
  }, [])
  const dismissPending = useCallback((localId: string) => {
    setPendingRows((previous) => previous.filter((row) => row.id !== localId))
  }, [])

  const { mutateAsync } = createOrder
  const retryPending = useCallback(
    (row: WorkshopOrderListPendingRow) => {
      if (retrying.current.has(row.id)) return
      retrying.current.add(row.id)
      setPendingRows((previous) =>
        previous.map((existing) => (existing.id === row.id ? { ...existing, pendingFailure: undefined } : existing)),
      )
      void createPendingWorkshopOrder(row.id, row.createPayload, mutateAsync, {
        createFailedMessage: t('orderIntake.toastCreateFailed'),
        onSettled: (localId, serverOrderId) => {
          onPendingOrderSettled(localId, serverOrderId)
          toast.success(t('orderIntake.toastOrderCreated'))
        },
        onFailed: onPendingOrderFailed,
      }).finally(() => retrying.current.delete(row.id))
    },
    [mutateAsync, onPendingOrderFailed, onPendingOrderSettled, t],
  )

  const intakePendingProps = useMemo(
    () => ({ listPendingMode: true as const, onPendingOrder, onPendingOrderSettled, onPendingOrderFailed }),
    [onPendingOrder, onPendingOrderFailed, onPendingOrderSettled],
  )

  const pendingActions = useMemo(
    () => ({
      onDismissPending: dismissPending,
      onRetryPending: retryPending,
      onOpenOrder: (orderId: string) => navigate(`/workshop/orders/${orderId}`),
    }),
    [dismissPending, navigate, retryPending],
  )

  return { tableRows, intakePendingProps, pendingActions }
}
