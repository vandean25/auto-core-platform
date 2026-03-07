import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { usePurchaseInvoices } from '@/api/usePurchaseInvoices'
import type { PurchaseInvoice, PurchaseInvoiceStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { StatusBadge } from '@/components/status/StatusBadge'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS: { value: PurchaseInvoiceStatus | 'ALL'; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'POSTED', label: 'Unpaid' },
    { value: 'PAID', label: 'Paid' },
]

export default function PurchaseBillsPage() {
    const navigate = useNavigate()
    const [selectedStatus, setSelectedStatus] = useState<PurchaseInvoiceStatus | 'ALL'>('ALL')
    const { columnFilters, setColumnFilters, sorting, setSorting, pagination, setPagination, globalFilter, setGlobalFilter } = useDataTableQuery({ 
        defaultPageSize: 10,
    })

    const { data: responseData, isLoading } = usePurchaseInvoices({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        status: selectedStatus === 'ALL' ? undefined : selectedStatus,
        sortBy: sorting[0]?.id || 'due_date',
        order: sorting[0]?.desc ? 'desc' : 'asc',
    })

    const invoices: PurchaseInvoice[] = responseData?.data || []
    const pageCount = responseData?.meta?.pageCount || 1

    const columns: ColumnDef<PurchaseInvoice>[] = [
        {
            accessorKey: 'vendor_invoice_number',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Bill #" />
            ),
            cell: ({ row }) => (
                <div className="font-medium">{row.original.vendor_invoice_number}</div>
            ),
        },
        {
            accessorKey: 'vendor.name',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Vendor" />
            ),
            cell: ({ row }) => (
                <div>{row.original.vendor?.name || '-'}</div>
            ),
        },
        {
            accessorKey: 'invoice_date',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Issue Date" />
            ),
            cell: ({ row }) => {
                if (!row.original.invoice_date) return <div>-</div>
                const date = new Date(row.original.invoice_date)
                if (isNaN(date.getTime())) return <div>-</div>
                return <div>{date.toLocaleDateString()}</div>
            },
        },
        {
            accessorKey: 'due_date',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Due Date" />
            ),
            cell: ({ row }) => {
                if (!row.original.due_date) return <div>-</div>
                const date = new Date(row.original.due_date)
                if (isNaN(date.getTime())) return <div>-</div>
                return <div>{date.toLocaleDateString()}</div>
            },
        },
        {
            accessorKey: 'total_amount',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Total Amount" />
            ),
            cell: ({ row }) => {
                const amount = parseFloat(row.original.total_amount)
                return (
                    <div className="text-right">
                        {amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </div>
                )
            },
        },
        {
            accessorKey: 'status',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Status" />
            ),
            cell: ({ row }) => {
                const status = row.original.status as PurchaseInvoiceStatus
                const label = status === 'POSTED' ? 'Unpaid' : status
                return <StatusBadge status={status} label={label} />
            },
        },
    ]

    const handleRowClick = (invoice: PurchaseInvoice) => {
        navigate(`/purchase-bills/${invoice.id}`)
    }

    return (
        <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Purchase Bills</h1>
                    <p className="text-slate-500 mt-1">Manage incoming vendor invoices and payment tracking</p>
                </div>
                <Button
                    onClick={() => navigate('/purchase-bills/new')}
                    className="gap-2"
                >
                    <Plus className="h-4 w-4" />
                    Log New Bill
                </Button>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex gap-2 border-b">
                {STATUS_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        onClick={() => {
                            setSelectedStatus(option.value as PurchaseInvoiceStatus | 'ALL')
                            setPagination({ pageIndex: 0, pageSize: pagination.pageSize })
                        }}
                        className={cn(
                            'px-4 py-2 text-sm font-medium transition-colors border-b-2',
                            selectedStatus === option.value
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-lg border">
                <DataTable
                    columns={columns}
                    data={invoices}
                    isLoading={isLoading}
                    pageCount={pageCount}
                    onRowClick={handleRowClick}
                    columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    sorting={sorting}
                    setSorting={setSorting}
                    pagination={pagination}
                    setPagination={setPagination}
                    globalFilter={globalFilter}
                    setGlobalFilter={setGlobalFilter}
                />
            </div>
        </div>
    )
}
