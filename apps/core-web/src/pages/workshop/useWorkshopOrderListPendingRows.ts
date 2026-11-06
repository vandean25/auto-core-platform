import { useMemo, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { useWorkshopOrders, workshopKeys } from '@/api/workshop'
import type { DataTablePendingRowMeta } from '@/components/data-table/data-table-states'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { useRetainedQueryData } from '@/hooks/useRetainedQueryData'
import { formatDate } from '@/lib/format'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'

type WorkshopOrderListPendingRow = WorkshopOrderListRow & DataTablePendingRowMeta

type OrdersPage = ReturnType<typeof useWorkshopOrders>['data']

export function useWorkshopOrderListRows(
  responseData: OrdersPage,
  isError: boolean,
  queryClient: QueryClient,
) {
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
  const pending = useWorkshopOrderListPendingRows(loadedRows, queryClient)
  return {
    visibleResponse,
    showingStaleError: isError && retained.isRetained,
    ...pending,
  }
}

function useWorkshopOrderListPendingRows(loadedRows: WorkshopOrderListRow[], queryClient: QueryClient) {
  const [pendingRows, setPendingRows] = useState<WorkshopOrderListPendingRow[]>([])

  const tableRows = useMemo(() => [...pendingRows, ...loadedRows], [loadedRows, pendingRows])

  const intakePendingProps = useMemo(
    () => ({
      listPendingMode: true as const,
      onPendingOrder: (row: WorkshopOrderListPendingRow) => {
        setPendingRows((previous) => [row, ...previous.filter((existing) => existing.id !== row.id)])
      },
      onPendingOrderSettled: (localId: string) => {
        setPendingRows((previous) => previous.filter((row) => row.id !== localId))
        void queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      },
      onPendingOrderFailed: (localId: string) => {
        setPendingRows((previous) => previous.filter((row) => row.id !== localId))
      },
    }),
    [queryClient],
  )

  return { tableRows, intakePendingProps }
}
