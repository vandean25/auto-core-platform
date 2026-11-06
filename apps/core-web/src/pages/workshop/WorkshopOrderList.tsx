import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { TooltipHint } from '@/components/ui/tooltip'
import { Plus } from 'lucide-react'
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { useWorkshopOrders } from '@/api/workshop'
import { DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS } from '@/features/dashboard-widgets/sources'
import { WorkshopOrderPeekSheet } from '@/features/peek/WorkshopOrderPeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { useWorkshopOrderListRowBehaviour } from './useWorkshopOrderListRowBehaviour'
import { useWorkshopOrderListColumns } from './useWorkshopOrderListColumns'
import { useWorkshopOrderListRows } from './useWorkshopOrderListPendingRows'

export default function WorkshopOrderList() {
  const { t } = useTranslation('workshop')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const presentationLatencyRef = useRef<number | null>(null)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const ordersQuery = useWorkshopOrders(queryParams)
  const peek = usePeekSearchParam()
  const rows = useWorkshopOrderListRows(ordersQuery.data, ordersQuery.isError, ordersQuery.dataUpdatedAt)
  const columns = useWorkshopOrderListColumns(t, tCommon, {
    onDismissPending: rows.intakePendingProps.onDismissPending,
    onRetryPending: () => setCreateOpen(true),
  })
  const rowBehaviour = useWorkshopOrderListRowBehaviour(
    t,
    navigate,
    queryClient,
    peek.openPeek,
    rows.tableRows,
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
        data={rows.tableRows}
        saveViewTitle={t('orders.list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS}
        pageCount={rows.visibleResponse?.meta?.pageCount ?? 1}
        isLoading={ordersQuery.isLoading}
        isFetching={ordersQuery.isFetching}
        isPlaceholderData={ordersQuery.isPlaceholderData || rows.showingStaleError}
        isError={ordersQuery.isError}
        onRetry={() => void ordersQuery.refetch()}
        hasUsableData={rows.visibleResponse !== undefined}
        presentationLatencyRef={presentationLatencyRef}
        searchPlaceholder={t('orders.list.searchPlaceholder')}
        emptyState={ordersQuery.isError ? undefined : {
          message: t('orders.list.empty'),
          action: (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className='h-4 w-4 mr-2' />
              {t('orders.list.emptyAction')}
            </Button>
          ),
        }}
        rowBehaviour={rowBehaviour}
        {...tableState}
      />
      <WorkshopOrderIntakeDialog open={createOpen} onOpenChange={setCreateOpen} {...rows.intakePendingProps} />
      <WorkshopOrderPeekSheet t={t} peekId={peek.peekId} isPeekOpen={peek.isPeekOpen} closePeek={peek.closePeek} />
    </div>
  )
}
