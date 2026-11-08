import { useEffect, useMemo, useState } from 'react'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDeleteVendor, useVendors } from '@/api/vendors'
import { Button } from '@/components/ui/button'
import { VendorDialog } from './VendorDialog'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Vendor } from '@/api/types'
import { toast } from 'sonner'
import { DASHBOARD_WIDGET_SOURCE_VENDORS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PAGE_HEADER_ROW } from '@/lib/page-header'
import { useVendorPendingCreate } from './useVendorPendingCreate'

function VendorNameCell({ vendor, onDismiss }: { vendor: Vendor; onDismiss: (localId: string) => void }) {
    const { t } = useTranslation('common')
    const failure = (vendor as PendingCreateRow<Vendor>).pendingFailure
    return (
        <div>
            <span className="inline-flex items-center gap-2 font-medium">
                {isDataTablePendingRow(vendor) ? <DataTablePendingIcon label={t('dataTable.loading.pendingRow')} /> : null}
                {vendor.name}
            </span>
            {failure ? <InteractionErrorMarker message={failure} onDismiss={() => onDismiss(vendor.id)} /> : null}
        </div>
    )
}

export default function VendorList() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading, dataUpdatedAt } = useVendors(queryParams)
    const deleteMutation = useDeleteVendor()
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    const data: Vendor[] = Array.isArray(responseData) ? responseData : responseData?.data ?? []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount ?? 1
    const pending = useVendorPendingCreate(data, dataUpdatedAt)

    const handleDelete = async (id: string) => {
        if (!confirm(t('vendors.list.deleteConfirm'))) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success(t('vendors.list.deleted'))
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('vendors.list.deleteFailed')))
        }
    }

    const columns: ColumnDef<Vendor>[] = useMemo(() => [
        {
            accessorKey: 'name',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.name')} />,
            cell: ({ row }) => <VendorNameCell vendor={row.original} onDismiss={pending.dismiss} />,
        },
        {
            accessorKey: 'email',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.email')} />,
        },
        {
            accessorKey: 'account_number',
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.accountNumber')} />,
            cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : row.original.account_number),
        },
        {
            accessorKey: 'supportedBrands',
            header: t('columns.supportedBrands'),
            enableSorting: false,
            cell: ({ row }) => isDataTablePendingRow(row.original) ? null : (
                <div className="flex flex-wrap gap-1">
                    {row.original.supportedBrands?.map((brand) => (
                        <Badge key={brand.id} variant="outline">
                            {brand.name}
                        </Badge>
                    ))}
                </div>
            ),
        },
    ], [pending.dismiss, t])

    return (
        <>
            <div className={PAGE_HEADER_ROW}>
                <div className="min-w-0 max-sm:w-full">
                    <h1 className="text-2xl font-semibold tracking-tight">{t('vendors.list.title')}</h1>
                    <p className="text-muted-foreground">{t('vendors.list.subtitle')}</p>
                </div>
                <Button className="max-sm:min-h-11" onClick={() => setIsDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> {t('vendors.list.create')}
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={pending.rows}
                saveViewTitle={t('vendors.list.saveViewTitle')}
                dashboardSource={DASHBOARD_WIDGET_SOURCE_VENDORS}
                pageCount={pageCount}
                isLoading={isLoading && pending.rows.length === data.length}
                bypassSkeleton={pending.rows.length !== data.length}
                searchColumn="name"
                searchPlaceholder={t('vendors.list.searchPlaceholder')}
                rowBehaviour={{
                  onRowClick: (row) => navigate(`/vendors/${row.id}`),
                  getRowContextActions: (row) => [
                    {
                      label: t('actions.delete'),
                      onClick: () => void handleDelete(row.id),
                      destructive: true,
                    },
                  ],
                }}
                {...tableState}
            />

            <VendorDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} onCreate={pending.submit} />
        </>
    )
}
