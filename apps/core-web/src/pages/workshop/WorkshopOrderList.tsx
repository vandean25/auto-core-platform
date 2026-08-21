import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'
import { DataTable } from '@/components/data-table/DataTable'
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
      openedAt: format(new Date(order.createdAt), 'PPP'),
      status: order.status,
    }))
  }, [responseData])

  const columns: ColumnDef<WorkshopOrderRow>[] = [
    {
      accessorKey: 'orderNo',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Order No.' />,
      cell: ({ row }) => <span className='font-medium'>{row.original.orderNo}</span>,
    },
    {
      accessorKey: 'customer',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Customer' />,
    },
    {
      accessorKey: 'vehicle',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Vehicle' />,
    },
    {
      accessorKey: 'openedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Opened' />,
      cell: ({ row }) => <span className='text-muted-foreground'>{row.original.openedAt}</span>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ]

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Workshop Orders</h1>
          <p className='text-slate-500'>Open a work order to view full job details and task drawer.</p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' onClick={() => navigate('/workshop/pick-list')}>
            Pick Queue
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className='h-4 w-4 mr-2' />
            Order
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        saveViewTitle='Workshop Orders'
        dashboardSource={DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS}
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
        searchPlaceholder='Search workshop orders...'
        onRowClick={(row) => navigate(`/workshop/orders/${row.id}`)}
        {...tableState}
      />

      <WorkshopOrderIntakeDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
