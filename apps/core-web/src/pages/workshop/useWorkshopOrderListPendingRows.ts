import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import type { DataTablePendingRowMeta } from '@/components/data-table/data-table-states'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'

type WorkshopOrderListPendingRow = WorkshopOrderListRow & DataTablePendingRowMeta

type OrdersResponse = { data?: { id: string }[] } | undefined

export function useWorkshopOrderListPendingRows(
  responseData: OrdersResponse,
  loadedRows: WorkshopOrderListRow[],
  queryClient: QueryClient,
) {
  const [pendingRows, setPendingRows] = useState<WorkshopOrderListPendingRow[]>([])
  const pendingServerIds = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const loaded = responseData?.data
    if (!loaded) return
    setPendingRows((previous) =>
      previous.filter((pending) => {
        const serverId = pendingServerIds.current.get(pending.id)
        if (!serverId) return true
        return !loaded.some((order) => order.id === serverId)
      }),
    )
  }, [responseData])

  const tableRows = useMemo(() => [...pendingRows, ...loadedRows], [loadedRows, pendingRows])

  const intakePendingProps = useMemo(
    () => ({
      listPendingMode: true as const,
      onPendingOrder: (row: WorkshopOrderListPendingRow, meta: { localId: string }) => {
        pendingServerIds.current.delete(meta.localId)
        setPendingRows((previous) => [row, ...previous])
      },
      onPendingOrderSettled: (localId: string, serverOrderId: string) => {
        pendingServerIds.current.set(localId, serverOrderId)
        void queryClient.invalidateQueries({ queryKey: ['workshop', 'orders'] })
      },
      onPendingOrderFailed: (localId: string) => {
        pendingServerIds.current.delete(localId)
        setPendingRows((previous) => previous.filter((row) => row.id !== localId))
      },
    }),
    [queryClient],
  )

  return { tableRows, intakePendingProps }
}
