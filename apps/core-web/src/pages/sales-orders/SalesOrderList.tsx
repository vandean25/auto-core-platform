import { type ColumnDef } from '@tanstack/react-table'
import { useSalesOrders } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { SalesOrder } from '@/api/types'

export default function SalesOrderList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useSalesOrders(queryParams)

    const data = Array.isArray(responseData) ? responseData : (responseData as any)?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : (responseData as any)?.meta?.pageCount || 1

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'DRAFT': return 'bg-slate-500'
            case 'CONFIRMED': return 'bg-blue-500'
            case 'IN_PROGRESS': return 'bg-orange-500'
            case 'COMPLETED': return 'bg-green-500'
            case 'INVOICED': return 'bg-purple-500'
            default: return 'bg-slate-500'
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
            cell: ({ row }) => (
                <Badge className={getStatusColor(row.original.status)}>
                    {row.original.status}
                </Badge>
            ),
        },
        {
            accessorKey: 'total_amount',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
            cell: ({ row }) => <div className="text-right font-medium">{formatCurrency(Number(row.original.total_amount))}</div>,
        },
        {
            id: 'actions',
            cell: ({ row }) => (
                <div className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                        <Link to={`/sales-orders/${row.original.id}`}>
                            Details <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            ),
        },
    ]

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Sales Orders</h1>
                    <p className="text-muted-foreground">
                        Manage your sales pipeline and job cards.
                    </p>
                </div>
                <Button asChild>
                    <Link to="/sales-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> New Order
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