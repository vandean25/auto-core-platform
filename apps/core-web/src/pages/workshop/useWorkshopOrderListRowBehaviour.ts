import { useCallback, useMemo } from 'react'
import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'

import {
  useGenerateWorkshopPdf,
  workshopOrderDetailQueryOptions,
} from '@/api/workshop'
import { canOpenWorkshopOrder } from '@/features/actions/action-role-predicates'
import { useAuthRole } from '@/features/actions/use-auth-role'
import {
  createWorkshopOrderRowActions,
  type WorkshopOrderListRow,
} from '@/features/actions/work-order-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'
import { useRegistryRowShortcuts } from '@/features/shortcuts/use-registry-row-shortcuts'

export function useWorkshopOrderListRowBehaviour(
  t: TFunction<'workshop'>,
  navigate: NavigateFunction,
  queryClient: QueryClient,
  openPeek: (id: string) => void,
  records: WorkshopOrderListRow[],
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
      getRowHref: (row: WorkshopOrderListRow) =>
        canOpenWorkshopOrder(role) ? `/workshop/orders/${row.id}` : undefined,
      getRowAccessibleName: (row: WorkshopOrderListRow) =>
        t('orders.list.rowAria', { orderNo: row.orderNo }),
      onRowClick: (row: WorkshopOrderListRow) => {
        if (canOpenWorkshopOrder(role)) openPeek(row.id)
      },
      onRowPrefetch: prefetchOrderDetail,
    }),
    [openPeek, prefetchOrderDetail, role, t],
  )

  const runContext = useMemo(
    () => ({ navigate, generatePdf, t }),
    [generatePdf, navigate, t],
  )

  useRegistryRowShortcuts({
    role,
    definitions: workOrderActionDefinitions,
    runContext,
    records,
  })

  return useRegistryRowBehaviour({
    role,
    definitions: workOrderActionDefinitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
