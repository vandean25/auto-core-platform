import { useNavigate } from 'react-router-dom'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useDeletePurchaseInvoice, usePurchaseInvoices } from '@/api/usePurchaseInvoices'
import type { PurchaseInvoice } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { StatusBadge } from '@/components/status/StatusBadge'
import { parseLocalDate } from '@/lib/date-utils'
import { DASHBOARD_WIDGET_SOURCE_PURCHASE_BILLS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'

export default function PurchaseBillsPage() {
    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ 
        defaultPageSize: 10,
        initialSorting: [{ id: 'due_date', desc: false }] 
    })

    const { data: responseData, isLoading } = usePurchaseInvoices(queryParams)
    const deleteMutation = useDeletePurchaseInvoice()

    const data: PurchaseInvoice[] = Array.isArray(responseData) ? responseData : responseData?.data ?? []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount ?? 1

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this bill?')) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Bill deleted')
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to delete bill'))
        }
    }

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
        <>
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
        </>
    )
}
