import { useEffect, useMemo } from 'react'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useDeletePurchaseOrder, usePurchaseOrders } from '@/api/purchase-orders'
import { Button } from '@/components/ui/button'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { PurchaseOrder } from '@/api/types'
import { toast } from 'sonner'
import { DASHBOARD_WIDGET_SOURCE_PURCHASE_ORDERS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PAGE_HEADER_ROW } from '@/lib/page-header'

export default function PurchaseOrderList() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = usePurchaseOrders(queryParams)
    const deleteMutation = useDeletePurchaseOrder()

    const data: PurchaseOrder[] = Array.isArray(responseData) ? responseData : responseData?.data ?? []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount ?? 1

    const handleDelete = async (id: string) => {
        if (!confirm(t('purchaseOrders.list.deleteConfirm'))) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success(t('purchaseOrders.list.deleted'))
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('purchaseOrders.list.deleteFailed')))
        }
    }

    const columns: ColumnDef<PurchaseOrder>[] = useMemo(() => [
        {
            accessorKey: 'order_number',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.orderNumber')} />,
            cell: ({ row }) => (
                <Link to={`/purchase-orders/${row.original.id}`} className="hover:underline font-medium">
                    {row.original.order_number}
                </Link>
            ),
        },
        {
            accessorKey: 'vendor.name',
            id: 'vendor',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.vendor')} />,
        },
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.status')} />,
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'createdAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.date')} />,
            cell: ({ row }) => formatDate(row.original.createdAt),
        },
        {
            accessorKey: 'items',
            header: t('columns.items'),
            enableSorting: false,
            cell: ({ row }) => <div className="text-right">{row.original.items?.length || 0}</div>,
        },
    ], [t])

    return (
        <>
            <div className={PAGE_HEADER_ROW}>
                <div className="min-w-0 max-sm:w-full">
                    <h1 className="text-2xl font-semibold tracking-tight">{t('purchaseOrders.list.title')}</h1>
                    <p className="text-slate-500">{t('purchaseOrders.list.subtitle')}</p>
                </div>
                <Button asChild>
                    <Link to="/purchase-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> {t('purchaseOrders.list.create')}
                    </Link>
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                saveViewTitle={t('purchaseOrders.list.saveViewTitle')}
                dashboardSource={DASHBOARD_WIDGET_SOURCE_PURCHASE_ORDERS}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="order_number"
                searchPlaceholder={t('purchaseOrders.list.searchPlaceholder')}
                rowBehaviour={{
                  onRowClick: (row) => navigate(`/purchase-orders/${row.id}`),
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
