import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { TooltipHint } from '@/components/ui/tooltip'
import { Plus } from 'lucide-react'
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { useWorkshopOrders } from '@/api/workshop'
import { DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS } from '@/features/dashboard-widgets/sources'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { WorkshopOrderPeekSheet } from '@/features/peek/WorkshopOrderPeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { useWorkshopOrderListRowBehaviour } from './useWorkshopOrderListRowBehaviour'
import { useWorkshopOrderListColumns } from './useWorkshopOrderListColumns'
import { useWorkshopOrderListPendingRows } from './useWorkshopOrderListPendingRows'

export default function WorkshopOrderList() {
  const { t } = useTranslation('workshop')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const presentationLatencyRef = useRef<number | null>(null)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const ordersQuery = useWorkshopOrders(queryParams)
  const { data: responseData, isLoading, isFetching, isPlaceholderData, isError, refetch } =
    ordersQuery
  const peek = usePeekSearchParam()
  const columns = useWorkshopOrderListColumns(t, tCommon)

  const loadedRows = useMemo<WorkshopOrderListRow[]>(() => {
    const source = responseData?.data ?? []
    return source.map((order) => ({
      id: order.id,
      orderNo: order.order_number ?? order.id,
      customer: getWorkshopCustomerDisplayName(order),
      vehicle: `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`,
      openedAt: formatDate(order.createdAt),
      status: order.status,
    }))
  }, [responseData])

  const { tableRows, intakePendingProps } = useWorkshopOrderListPendingRows(
    responseData,
    loadedRows,
    queryClient,
  )

  const rowBehaviour = useWorkshopOrderListRowBehaviour(
    t,
    navigate,
    queryClient,
    peek.openPeek,
    tableRows,
  )

  return (
    <div className='space-y-6'>
      <PageHeader
        title={t('orders.list.title')}
        description={t('orders.list.description')}
        actions={
          <>
            <TooltipHint hint={t('orders.list.partsPickHint')}>
              <Button variant='outline' onClick={() => navigate('/workshop/pick-list')}>
                {t('orders.list.partsPickQueue')}
              </Button>
            </TooltipHint>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className='h-4 w-4 mr-2' />
              {t('orders.list.newOrder')}
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={tableRows}
        saveViewTitle={t('orders.list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS}
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
        isFetching={isFetching}
        isPlaceholderData={isPlaceholderData}
        isError={isError}
        onRetry={() => void refetch()}
        hasUsableData={responseData !== undefined}
        presentationLatencyRef={presentationLatencyRef}
        searchPlaceholder={t('orders.list.searchPlaceholder')}
        emptyState={
          isError
            ? undefined
            : {
                message: t('orders.list.empty'),
                action: (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className='h-4 w-4 mr-2' />
                    {t('orders.list.emptyAction')}
                  </Button>
                ),
              }
        }
        rowBehaviour={rowBehaviour}
        {...tableState}
      />

      <WorkshopOrderIntakeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        {...intakePendingProps}
      />
      <WorkshopOrderPeekSheet
        t={t}
        peekId={peek.peekId}
        isPeekOpen={peek.isPeekOpen}
        closePeek={peek.closePeek}
      />
    </div>
  )
}
