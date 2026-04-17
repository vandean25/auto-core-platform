import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { ArrowRight, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useWorkshopPickList } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { WorkshopOrderPickDrawer } from '@/features/workshop/components/WorkshopOrderPickDrawer'
import {
  getWorkshopCustomerDisplayName,
  getRequiredPartLines,
  getTotalRequiredQuantity,
} from '@/features/workshop/pick-utils'

interface WorkshopPickQueueRow {
  id: string
  orderNo: string
  customer: string
  vehicle: string
  openedAt: string
  status: WorkshopOrder['status']
  partLines: number
  requiredQty: number
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(Math.trunc(value)) : value.toFixed(2)
}

export default function WorkshopPickList() {
  const navigate = useNavigate()
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useWorkshopPickList(queryParams)

  const rows = useMemo<WorkshopPickQueueRow[]>(() => {
    const source = responseData?.data ?? []
    return source.map((order) => {
      const requiredPartLines = getRequiredPartLines(order)
      return {
        id: order.id,
        orderNo: order.order_number ?? order.id,
        customer: getWorkshopCustomerDisplayName(order),
        vehicle: `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`,
        openedAt: format(new Date(order.createdAt), 'PPP'),
        status: order.status,
        partLines: requiredPartLines.length,
        requiredQty: getTotalRequiredQuantity(requiredPartLines),
      }
    })
  }, [responseData])

  const columns: ColumnDef<WorkshopPickQueueRow>[] = [
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
      accessorKey: 'partLines',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Part Lines' />,
      cell: ({ row }) => <span className='tabular-nums'>{row.original.partLines}</span>,
    },
    {
      accessorKey: 'requiredQty',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Total Qty' />,
      cell: ({ row }) => <span className='tabular-nums'>{formatQuantity(row.original.requiredQty)}</span>,
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
    <div className='w-full max-w-7xl mx-auto p-6 space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Workshop Pick Queue</h1>
          <p className='text-slate-500'>Select an order row to open the pick drawer and stage required parts.</p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' onClick={() => navigate('/workshop/orders')}>
            <ListChecks className='h-4 w-4 mr-2' />
            Workshop Orders
          </Button>
          <Button variant='outline' onClick={() => navigate('/workshop/intake')}>
            Intake
            <ArrowRight className='h-4 w-4 ml-2' />
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        saveViewTitle='Workshop Pick Queue'
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
        searchPlaceholder='Search pick queue...'
        onRowClick={(row) => {
          setActiveOrderId(row.id)
          setIsDrawerOpen(true)
        }}
        {...tableState}
      />

      <WorkshopOrderPickDrawer
        open={isDrawerOpen}
        orderId={activeOrderId}
        onOpenChange={(nextOpen) => {
          setIsDrawerOpen(nextOpen)
          if (!nextOpen) {
            setActiveOrderId(null)
          }
        }}
      />
    </div>
  )
}
