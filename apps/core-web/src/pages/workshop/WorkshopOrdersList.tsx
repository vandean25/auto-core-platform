import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { useWorkshopOrders } from '@/api/workshop'
import type { WorkshopOrder, WorkshopOrderStatus } from '@/api/types'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { format } from 'date-fns'
import { Wrench, Clock, CheckCircle2, Calendar } from 'lucide-react'

const StatusBadge = ({ status }: { status: WorkshopOrderStatus }) => {
    const config: Record<WorkshopOrderStatus, { label: string, color: string, icon: React.ReactNode }> = {
        SCHEDULED: { label: 'Scheduled', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: <Calendar className="w-3 h-3 mr-1" /> },
        INTAKE: { label: 'Intake', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: <Clock className="w-3 h-3 mr-1" /> },
        IN_PROGRESS: { label: 'In Progress', color: 'bg-purple-100 text-purple-800 border-purple-200', icon: <Wrench className="w-3 h-3 mr-1" /> },
        COMPLETED: { label: 'Completed', color: 'bg-green-100 text-green-800 border-green-200', icon: <CheckCircle2 className="w-3 h-3 mr-1" /> },
    }

    const { label, color, icon } = config[status]

    return (
        <Badge variant="outline" className={`${color} flex items-center w-fit`}>
            {icon}
            {label}
        </Badge>
    )
}

export default function WorkshopOrdersList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useWorkshopOrders(queryParams)

    const data = responseData?.data || []
    const totalPages = responseData?.meta?.totalPages || 1

    const columns: ColumnDef<WorkshopOrder>[] = [
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'vehicle',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vehicle" />,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-bold text-slate-900">
                        {row.original.vehicle.year} {row.original.vehicle.make} {row.original.vehicle.model}
                    </span>
                    <span className="text-sm text-slate-500">
                        Plate: {row.original.vehicle.plate || 'N/A'} | VIN: {row.original.vehicle.vin || 'N/A'}
                    </span>
                </div>
            ),
        },
        {
            accessorKey: 'customer',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-slate-900 font-medium">
                        {row.original.customer.first_name} {row.original.customer.last_name}
                    </span>
                    <span className="text-xs text-slate-500">{row.original.customer.email}</span>
                </div>
            ),
        },
        {
            accessorKey: 'createdAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
            cell: ({ row }) => (
                <span className="text-slate-600">
                    {format(new Date(row.original.createdAt), 'dd.MM.yyyy HH:mm')}
                </span>
            ),
        },
        {
            accessorKey: 'odometer',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Odometer" />,
            cell: ({ row }) => (
                <span className="text-slate-600 font-mono">
                    {row.original.odometer != null ? `${row.original.odometer.toLocaleString()} km` : 'N/A'}
                </span>
            ),
        },
    ]

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Workshop Orders</h1>
                    <p className="text-slate-500">View and manage all active vehicle services.</p>
                </div>
            </div>

            <DataTable
                columns={columns}
                data={data}
                pageCount={totalPages}
                isLoading={isLoading}
                searchColumn="vehicle.plate"
                searchPlaceholder="Search by plate..."
                {...tableState}
            />
        </div>
    )
}
