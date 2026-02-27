import { type ColumnDef } from '@tanstack/react-table'
import { useDeletePurchaseOrder, usePurchaseOrders } from '@/api/purchase-orders'
import { Button } from '@/components/ui/button'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { format } from 'date-fns'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { PurchaseOrder } from '@/api/types'
import { toast } from 'sonner'

export default function PurchaseOrderList() {
    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = usePurchaseOrders(queryParams)
    const deleteMutation = useDeletePurchaseOrder()

    const data = Array.isArray(responseData) ? responseData : (responseData as any)?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : (responseData as any)?.meta?.pageCount || 1

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this purchase order?')) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Purchase order deleted')
        } catch (error: any) {
            toast.error(error?.message || 'Failed to delete purchase order')
        }
    }

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
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Purchase Orders</h1>
                    <p className="text-slate-500">Manage your orders and track incoming deliveries.</p>
                </div>
                <Button asChild>
                    <Link to="/purchase-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> Purchase Order
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
                onRowClick={(row) => navigate(`/purchase-orders/${row.id}`)}
                getRowContextActions={(row) =>
                    row.status === 'DRAFT'
                        ? [
                              {
                                  label: 'Delete',
                                  onClick: () => void handleDelete(row.id),
                                  destructive: true,
                              },
                          ]
                        : []
                }
                {...tableState}
            />
        </div>
    )
}
