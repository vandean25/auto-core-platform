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
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'
import type { PurchaseOrder } from '@/api/types'
import { toast } from 'sonner'
import { DASHBOARD_WIDGET_SOURCE_PURCHASE_ORDERS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PAGE_HEADER_ROW } from '@/lib/page-header'
import { usePurchaseOrderPendingCreate } from './usePurchaseOrderPendingCreate'

function OrderNumberCell({ order, onDismiss }: { order: PurchaseOrder; onDismiss: (localId: string) => void }) {
    const { t } = useTranslation('common')
    if (!isDataTablePendingRow(order)) {
        return (
            <Link to={`/purchase-orders/${order.id}`} className="hover:underline font-medium">
                {order.order_number}
            </Link>
        )
    }
    const failure = (order as PendingCreateRow<PurchaseOrder>).pendingFailure
    return (
        <div>
            <DataTablePendingIcon label={t('dataTable.loading.pendingRow')} />
            {failure ? <InteractionErrorMarker message={failure} onDismiss={() => onDismiss(order.id)} /> : null}
        </div>
    )
}

export default function PurchaseOrderList() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading, dataUpdatedAt } = usePurchaseOrders(queryParams)
    const deleteMutation = useDeletePurchaseOrder()

    const data: PurchaseOrder[] = Array.isArray(responseData) ? responseData : responseData?.data ?? []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount ?? 1
    const pending = usePurchaseOrderPendingCreate(data, dataUpdatedAt)

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
            cell: ({ row }) => <OrderNumberCell order={row.original} onDismiss={pending.dismiss} />,
        },
        {
            accessorKey: 'vendor.name',
            id: 'vendor',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.vendor')} />,
            cell: ({ row }) => row.original.vendor?.name,
        },
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.status')} />,
            cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : <StatusBadge status={row.original.status} />),
        },
        {
            accessorKey: 'createdAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.date')} />,
            cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : formatDate(row.original.createdAt)),
        },
        {
            accessorKey: 'items',
            header: t('columns.items'),
            enableSorting: false,
            cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : <div className="text-right">{row.original.items?.length || 0}</div>),
        },
    ], [pending.dismiss, t])

    return (
        <>
            <div className={PAGE_HEADER_ROW}>
                <div className="min-w-0 max-sm:w-full">
                    <h1 className="text-2xl font-semibold tracking-tight">{t('purchaseOrders.list.title')}</h1>
                    <p className="text-muted-foreground">{t('purchaseOrders.list.subtitle')}</p>
                </div>
                <Button asChild className="max-sm:min-h-11">
                    <Link to="/purchase-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> {t('purchaseOrders.list.create')}
                    </Link>
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={pending.rows}
                saveViewTitle={t('purchaseOrders.list.saveViewTitle')}
                dashboardSource={DASHBOARD_WIDGET_SOURCE_PURCHASE_ORDERS}
                pageCount={pageCount}
                isLoading={isLoading && pending.rows.length === data.length}
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
