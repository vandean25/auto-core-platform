import { useCallback, useMemo } from 'react'
import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'

import {
  useGenerateWorkshopPdf,
  workshopOrderDetailQueryOptions,
} from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { createWorkshopOrderRowActions } from '@/features/actions/work-order-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'

export type WorkshopOrderListRow = {
  id: string
  orderNo: string
  customer: string
  vehicle: string
  openedAt: string
  status: WorkshopOrder['status']
}

export function useWorkshopOrderListRowBehaviour(
  t: TFunction<'workshop'>,
  navigate: NavigateFunction,
  queryClient: QueryClient,
) {
  const role = useAuthRole()
  const generatePdf = useGenerateWorkshopPdf()

  const prefetchOrderDetail = useCallback(
    (row: WorkshopOrderListRow) => {
      void queryClient.prefetchQuery(workshopOrderDetailQueryOptions(row.id))
    },
    [queryClient],
  )

  const workOrderActionDefinitions = useMemo(() => createWorkshopOrderRowActions(t), [t])

  const tableRowBehaviour = useMemo(
    () => ({
      getRowHref: (row: WorkshopOrderListRow) => `/workshop/orders/${row.id}`,
      getRowAccessibleName: (row: WorkshopOrderListRow) =>
        t('orders.list.rowAria', { orderNo: row.orderNo }),
      onRowClick: (row: WorkshopOrderListRow) => navigate(`/workshop/orders/${row.id}`),
      onRowPrefetch: prefetchOrderDetail,
    }),
    [navigate, prefetchOrderDetail, t],
  )

  const runContext = useMemo(
    () => ({ navigate, generatePdf, t }),
    [generatePdf, navigate, t],
  )

  return useRegistryRowBehaviour({
    role,
    definitions: workOrderActionDefinitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
