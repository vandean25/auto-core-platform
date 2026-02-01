import { type ColumnDef } from '@tanstack/react-table'
import { usePurchaseOrders } from '@/api/purchase-orders'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { format } from 'date-fns'
import { getPOStatusVariant } from '@/lib/utils'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { PurchaseOrder } from '@/api/types'

export default function PurchaseOrderList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = usePurchaseOrders(queryParams)

    const data = Array.isArray(responseData) ? responseData : (responseData as any)?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : (responseData as any)?.meta?.pageCount || 1

    const columns: ColumnDef<PurchaseOrder>[] = [
        {
            accessorKey: 'order_number',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Order #" />,
            cell: ({ row }) => (
                <Link to={`/purchase-orders/${row.original.id}`} className="hover:underline font-medium">
                    {row.original.order_number}
                </Link>
            ),
        },
        {
            accessorKey: 'vendor.name',
            id: 'vendor',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        },
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => (
                <Badge variant={getPOStatusVariant(row.original.status)}>
                    {row.original.status}
                </Badge>
            ),
        },
        {
            accessorKey: 'createdAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
            cell: ({ row }) => format(new Date(row.original.createdAt), 'PPP'),
        },
        {
            accessorKey: 'items',
            header: 'Items',
            enableSorting: false,
            cell: ({ row }) => <div className="text-right">{row.original.items?.length || 0}</div>,
        },
    ]

    return (
        <div className="p-8 space-y-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Purchase Orders</h1>
                <Button asChild>
                    <Link to="/purchase-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> Create PO
                    </Link>
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="order_number"
                searchPlaceholder="Search orders..."
                {...tableState}
            />
        </div>
    )
}