import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { formatCurrency, formatDate } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'

export default function PurchaseBillsPage() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

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
        if (!confirm(t('purchaseBills.list.deleteConfirm'))) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success(t('purchaseBills.list.deleted'))
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('purchaseBills.list.deleteFailed')))
        }
    }

    const columns: ColumnDef<PurchaseInvoice>[] = useMemo(() => [
        {
            accessorKey: 'vendor_invoice_number',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('columns.billNumber')} />
            ),
            cell: ({ row }) => (
                <div className="font-medium">{row.original.vendor_invoice_number}</div>
            ),
        },
        {
            accessorKey: 'vendor.name',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('columns.vendor')} />
            ),
            cell: ({ row }) => (
                <div>{row.original.vendor?.name ?? t('placeholders.missing', { ns: 'common' })}</div>
            ),
        },
        {
            accessorKey: 'invoice_date',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('columns.issueDate')} />
            ),
            cell: ({ row }) => {
                const date = parseLocalDate(row.original.invoice_date)
                if (!date) return <div>{t('placeholders.missing', { ns: 'common' })}</div>
                return <div>{formatDate(date)}</div>
            },
        },
        {
            accessorKey: 'due_date',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('columns.dueDate')} />
            ),
            cell: ({ row }) => {
                const date = parseLocalDate(row.original.due_date)
                if (!date) return <div>{t('placeholders.missing', { ns: 'common' })}</div>
                return <div>{formatDate(date)}</div>
            },
        },
        {
            accessorKey: 'total_amount',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('columns.totalAmount')} />
            ),
            cell: ({ row }) => {
                const amount = parseFloat(row.original.total_amount)
                return (
                    <div className="text-right font-medium">
                        {formatCurrency(amount)}
                    </div>
                )
            },
        },
        {
            accessorKey: 'status',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('columns.status')} />
            ),
            cell: ({ row }) => {
                if (row.original.status === 'POSTED') {
                    return (
                        <StatusBadge
                            status={row.original.status}
                            label={t('purchaseBills.list.statusUnpaid')}
                        />
                    )
                }
                return <StatusBadge status={row.original.status} />
            },
        },
    ], [t])

    const handleRowClick = (invoice: PurchaseInvoice) => {
        navigate(`/purchase-bills/${invoice.id}`)
    }

    return (
        <>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{t('purchaseBills.list.title')}</h1>
                    <p className="text-slate-500">{t('purchaseBills.list.subtitle')}</p>
                </div>
                <Button onClick={() => navigate('/purchase-bills/new')}>
                    <Plus className="mr-2 h-4 w-4" /> {t('purchaseBills.list.create')}
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                saveViewTitle={t('purchaseBills.list.saveViewTitle')}
                dashboardSource={DASHBOARD_WIDGET_SOURCE_PURCHASE_BILLS}
                isLoading={isLoading}
                pageCount={pageCount}
                rowBehaviour={{
                  onRowClick: handleRowClick,
                  getRowContextActions: (row) =>
                    row.status === 'DRAFT'
                      ? [
                          {
                            label: t('actions.delete'),
                            onClick: () => void handleDelete(row.id),
                            destructive: true,
                          },
                        ]
                      : [],
                }}
                {...tableState}
            />
        </>
    )
}
