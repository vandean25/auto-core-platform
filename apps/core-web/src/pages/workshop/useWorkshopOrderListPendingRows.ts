import { useMemo, useState } from 'react'

import { useWorkshopOrders } from '@/api/workshop'
import type { DataTablePendingRowMeta } from '@/components/data-table/data-table-states'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import { useRetainedQueryData } from '@/hooks/useRetainedQueryData'
import { formatDate } from '@/lib/format'

export type WorkshopOrderListPendingRow = WorkshopOrderListRow & DataTablePendingRowMeta & {
  pendingError?: string
}

type OrdersPage = ReturnType<typeof useWorkshopOrders>['data']

export function useWorkshopOrderListRows(responseData: OrdersPage, isError: boolean, dataUpdatedAt = 0) {
  const retained = useRetainedQueryData(responseData)
  const visibleResponse = retained.data
  const loadedRows = useMemo<WorkshopOrderListRow[]>(() => {
    const source = visibleResponse?.data ?? []
    return source.map((order) => ({
      id: order.id,
      orderNo: order.order_number ?? order.id,
      customer: getWorkshopCustomerDisplayName(order),
      vehicle: `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`,
      openedAt: formatDate(order.createdAt),
      status: order.status,
    }))
  }, [visibleResponse])
  const pending = useWorkshopOrderListPendingRows(loadedRows, visibleResponse, dataUpdatedAt)
  return {
    visibleResponse,
    showingStaleError: isError && retained.isRetained,
    ...pending,
  }
}

type PendingSettlement = {
  serverOrderId: string
  page: OrdersPage
  updatedAt: number
}

function useWorkshopOrderListPendingRows(
  loadedRows: WorkshopOrderListRow[],
  visibleResponse: OrdersPage,
  dataUpdatedAt: number,
) {
  const [pendingRows, setPendingRows] = useState<WorkshopOrderListPendingRow[]>([])
  const [settled, setSettled] = useState<Record<string, PendingSettlement>>({})

  const tableRows = useMemo(() => {
    const stillPending = pendingRows.filter((pending) => {
      const settlement = settled[pending.id]
      if (!settlement) return true
      if (loadedRows.some((row) => row.id === settlement.serverOrderId)) return false
      return settlement.page === visibleResponse && settlement.updatedAt === dataUpdatedAt
    })
    return [...stillPending, ...loadedRows]
  }, [dataUpdatedAt, loadedRows, pendingRows, settled, visibleResponse])

  const intakePendingProps = {
    listPendingMode: true as const,
    onPendingOrder: (row: WorkshopOrderListPendingRow) => {
      setPendingRows((previous) => [row, ...previous.filter((existing) => existing.id !== row.id)])
    },
    onPendingOrderSettled: (localId: string, serverOrderId: string) => {
      setSettled((previous) => ({
        ...previous,
        [localId]: { serverOrderId, page: visibleResponse, updatedAt: dataUpdatedAt },
      }))
    },
    onPendingOrderFailed: (localId: string, message: string) => {
      setPendingRows((previous) =>
        previous.map((row) => (row.id === localId ? { ...row, pendingError: message } : row)),
      )
    },
    onDismissPending: (localId: string) => {
      setPendingRows((previous) => previous.filter((row) => row.id !== localId))
    },
  }

  return { tableRows, intakePendingProps }
}
