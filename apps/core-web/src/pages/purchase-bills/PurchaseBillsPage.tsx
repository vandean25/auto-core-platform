import { useNavigate } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { usePurchaseInvoices } from '@/api/usePurchaseInvoices'
import type { PurchaseInvoice } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { StatusBadge } from '@/components/status/StatusBadge'
import { parseLocalDate } from '@/lib/date-utils'
import { DASHBOARD_WIDGET_SOURCE_PURCHASE_BILLS } from '@/features/dashboard-widgets/sources'

export default function PurchaseBillsPage() {
    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ 
        defaultPageSize: 10,
        initialSorting: [{ id: 'due_date', desc: false }] 
    })

    const { data: responseData, isLoading } = usePurchaseInvoices(queryParams)

    const data: PurchaseInvoice[] = Array.isArray(responseData) ? responseData : (responseData as any)?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : (responseData as any)?.meta?.pageCount || 1

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
                const date = parseLocalDate(row.original.invoice_date)
                if (!date) return <div>-</div>
                return <div>{date.toLocaleDateString()}</div>
            },
        },
        {
            accessorKey: 'due_date',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Due Date" />
            ),
            cell: ({ row }) => {
                const date = parseLocalDate(row.original.due_date)
                if (!date) return <div>-</div>
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
                    <div className="text-right font-medium">
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
                return <StatusBadge status={row.original.status} label={row.original.status === 'POSTED' ? 'Unpaid' : row.original.status} />
            },
        },
    ]

    const handleRowClick = (invoice: PurchaseInvoice) => {
        navigate(`/purchase-bills/${invoice.id}`)
    }

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Purchase Bills</h1>
                    <p className="text-slate-500">Manage incoming vendor invoices and payment tracking</p>
                </div>
                <Button onClick={() => navigate('/purchase-bills/new')}>
                    <Plus className="mr-2 h-4 w-4" /> Bill
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                saveViewTitle="Purchase Bills"
                dashboardSource={DASHBOARD_WIDGET_SOURCE_PURCHASE_BILLS}
                isLoading={isLoading}
                pageCount={pageCount}
                onRowClick={handleRowClick}
                {...tableState}
            />
        </div>
    )
}
