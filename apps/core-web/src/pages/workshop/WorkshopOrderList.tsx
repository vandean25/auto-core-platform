import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { TooltipHint } from '@/components/ui/tooltip'
import { Plus } from 'lucide-react'
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useWorkshopOrders } from '@/api/workshop'
import { DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS } from '@/features/dashboard-widgets/sources'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { WorkshopOrderPeekSheet } from '@/features/peek/WorkshopOrderPeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { useWorkshopOrderListRowBehaviour } from './useWorkshopOrderListRowBehaviour'

export default function WorkshopOrderList() {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading, isError } = useWorkshopOrders(queryParams)
  const peek = usePeekSearchParam()

  const rows = useMemo<WorkshopOrderListRow[]>(() => {
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

  const rowBehaviour = useWorkshopOrderListRowBehaviour(
    t,
    navigate,
    queryClient,
    peek.openPeek,
    rows,
  )

  const columns: ColumnDef<WorkshopOrderListRow>[] = [
    {
      accessorKey: 'orderNo',
      meta: { rowLink: true, mobile: 'trailing', label: t('orders.list.columns.orderNo') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.orderNo')} />
      ),
      cell: ({ row }) => row.original.orderNo,
    },
    {
      accessorKey: 'customer',
      meta: { mobile: 'title', label: t('orders.list.columns.customer') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.customer')} />
      ),
    },
    {
      accessorKey: 'vehicle',
      meta: { mobile: 'subtitle', label: t('orders.list.columns.vehicle') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.vehicle')} />
      ),
    },
    {
      accessorKey: 'openedAt',
      meta: { label: t('orders.list.columns.opened') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.opened')} />
      ),
      cell: ({ row }) => <span className='text-muted-foreground'>{row.original.openedAt}</span>,
    },
    {
      accessorKey: 'status',
      meta: { mobile: 'status', label: t('orders.list.columns.status') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.status')} />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ]

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
        data={rows}
        saveViewTitle={t('orders.list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS}
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
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

      <WorkshopOrderIntakeDialog open={createOpen} onOpenChange={setCreateOpen} />
      <WorkshopOrderPeekSheet
        t={t}
        navigate={navigate}
        peekId={peek.peekId}
        isPeekOpen={peek.isPeekOpen}
        closePeek={peek.closePeek}
      />
    </div>
  )
}
