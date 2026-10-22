import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
import type { WorkshopOrder } from '@/api/types'
import { DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS } from '@/features/dashboard-widgets/sources'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'

interface WorkshopOrderRow {
  id: string
  orderNo: string
  customer: string
  vehicle: string
  openedAt: string
  status: WorkshopOrder['status']
}

export default function WorkshopOrderList() {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useWorkshopOrders(queryParams)

  const rows = useMemo<WorkshopOrderRow[]>(() => {
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

  const columns: ColumnDef<WorkshopOrderRow>[] = [
    {
      accessorKey: 'orderNo',
      meta: { rowLink: true, label: t('orders.list.columns.orderNo') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.orderNo')} />
      ),
      cell: ({ row }) => row.original.orderNo,
    },
    {
      accessorKey: 'customer',
      meta: { label: t('orders.list.columns.customer') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.customer')} />
      ),
    },
    {
      accessorKey: 'vehicle',
      meta: { label: t('orders.list.columns.vehicle') },
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
      meta: { label: t('orders.list.columns.status') },
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
        emptyState={{
          message: t('orders.list.empty'),
          action: (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className='h-4 w-4 mr-2' />
              {t('orders.list.newOrder')}
            </Button>
          ),
        }}
        getRowHref={(row) => `/workshop/orders/${row.id}`}
        getRowAccessibleName={(row) => t('orders.list.rowAria', { orderNo: row.orderNo })}
        onRowClick={(row) => navigate(`/workshop/orders/${row.id}`)}
        {...tableState}
      />

      <WorkshopOrderIntakeDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
