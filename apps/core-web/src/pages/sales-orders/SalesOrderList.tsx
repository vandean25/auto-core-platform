import { type ColumnDef } from '@tanstack/react-table'
import { useDeleteSalesOrder, useSalesOrders } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { SalesOrder } from '@/api/types'
import { toast } from 'sonner'
import { DASHBOARD_WIDGET_SOURCE_SALES_ORDERS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'

export default function SalesOrderList() {
    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useSalesOrders(queryParams)
    const deleteMutation = useDeleteSalesOrder()

    const data = Array.isArray(responseData) ? responseData : responseData?.data ?? []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount ?? 1

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this sales order?')) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Sales order deleted')
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to delete sales order'))
        }
    }

    const columns: ColumnDef<SalesOrder>[] = [
        {
            accessorKey: 'order_number',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Order #" />,
            cell: ({ row }) => <span className="font-medium">{row.original.order_number}</span>,
        },
        {
            accessorKey: 'createdAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
            cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
        },
        {
            accessorKey: 'customer.last_name', // Filter on last name by default or use a computed field in backend? 
            // The backend whitelist has customer.last_name and customer.company_name.
            // I'll use id "customer" and accessorFn to render correctly.
            id: 'customer',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
            cell: ({ row }) => (
                <span>
                    {row.original.customer.type === 'COMPANY'
                        ? row.original.customer.company_name
                        : `${row.original.customer.first_name} ${row.original.customer.last_name}`}
                </span>
            ),
        },
        {
            accessorKey: 'vehicle',
            header: 'Vehicle',
            enableSorting: false,
            cell: ({ row }) => (
                <span>{row.original.vehicle ? `${row.original.vehicle.make} ${row.original.vehicle.model}` : '-'}</span>
            ),
        },
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'total_amount',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
            cell: ({ row }) => <div className="text-right font-medium">{formatCurrency(Number(row.original.total_amount))}</div>,
        },
    ]

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Sales Orders</h1>
                    <p className="text-slate-500">Manage your sales pipeline and job cards.</p>
                </div>
                <Button asChild>
                    <Link to="/sales-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> Order
                    </Link>
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                saveViewTitle="Sales Orders"
                dashboardSource={DASHBOARD_WIDGET_SOURCE_SALES_ORDERS}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="order_number"
                searchPlaceholder="Search orders..."
                onRowClick={(row) => navigate(`/sales-orders/${row.id}`)}
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
