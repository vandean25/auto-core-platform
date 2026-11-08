import * as React from 'react'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { inventoryItemDetailQueryOptions } from '@/api/inventory'
import { useInventoryListState } from '@/api/inventory-list'
import { useLocations } from '@/api/locations'
import type { InventoryItem } from '@/api/types'
import { AddItemDialog } from '@/components/AddItemDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { InventoryBulkActions } from '@/components/inventory/InventoryBulkActions'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { canOpenBackOfficeDetail } from '@/features/actions/action-role-predicates'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { DASHBOARD_WIDGET_SOURCE_INVENTORY } from '@/features/dashboard-widgets/sources'
import { scheduleDetailPrefetch } from '@/lib/intent-prefetch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGE_HEADER_ROW } from '@/lib/page-header'
import {
    InventoryDescriptionCell,
    InventoryLocationCell,
    InventoryPartCell,
    InventoryPriceCell,
    InventoryStatusCell,
} from './inventory-list-cells'
import { useInventoryPendingCreate } from './useInventoryPendingCreate'

export default function InventoryList() {
    const { t } = useTranslation('inventory')
    useEffect(() => {
        void ensureNamespaceLoaded('inventory')
    }, [])
    const navigate = useNavigate()
    const role = useAuthRole()
    const queryClient = useQueryClient()
    const { queryParams, columnFilters, setColumnFilters, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

    const searchFromNameFilter = queryParams.filters.find((f) => f.field === 'name')?.value
    const locationFilter = queryParams.filters.find((f) => f.field === 'location')?.value

    const list = useInventoryListState(queryParams, {
        search: queryParams.search ?? searchFromNameFilter,
        location: locationFilter,
    })
    const pending = useInventoryPendingCreate(list.rows, list.dataUpdatedAt)
    const { data: locations } = useLocations()

    const warehouseLocations = React.useMemo(
        () => (locations ?? []).filter((location) => location.type === 'warehouse'),
        [locations],
    )

    const locationFilterValue = columnFilters.find((filter) => filter.id === 'location')?.value as
        | string
        | undefined

    const handleLocationFilter = (value: string) => {
        setColumnFilters((previous: ColumnFiltersState) => {
            const without = previous.filter((filter) => filter.id !== 'location')
            if (value === '_all') return without
            return [...without, { id: 'location', value }]
        })
    }

    const columns: ColumnDef<InventoryItem>[] = [
        {
            accessorKey: 'status',
            enableSorting: false,
            meta: { label: t('partsList.columns.status'), mobile: 'status' },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.status')} />,
            cell: ({ row }) => <InventoryStatusCell item={row.original} />,
        },
        {
            accessorKey: 'sku',
            meta: { label: t('partsList.columns.part'), mobile: 'title' },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.part')} />,
            cell: ({ row }) => <InventoryPartCell item={row.original} />,
        },
        {
            accessorKey: 'name',
            meta: { label: t('partsList.columns.description'), mobile: 'subtitle' },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.description')} />,
            cell: ({ row }) => <InventoryDescriptionCell item={row.original} onDismiss={pending.dismiss} />,
        },
        {
            accessorKey: 'warehouse_location',
            enableSorting: false,
            meta: { label: t('partsList.columns.storageLocation') },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.storageLocation')} />,
            cell: ({ row }) => <InventoryLocationCell item={row.original} />,
        },
        {
            accessorKey: 'price',
            meta: { label: t('partsList.columns.price'), mobile: 'trailing', numeric: true },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.price')} />,
            cell: ({ row }) => <InventoryPriceCell item={row.original} />,
        },
    ]

    return (
        <>
            <div className={PAGE_HEADER_ROW}>
                <div className="min-w-0 max-sm:w-full">
                    <h1 className="text-2xl font-semibold tracking-tight">{t('partsList.title')}</h1>
                    <p className="text-muted-foreground">{t('partsList.description')}</p>
                </div>
                <AddItemDialog onCreate={pending.submit} />
            </div>

            <div className="mb-4 flex items-center gap-2">
                <Select value={locationFilterValue ?? '_all'} onValueChange={handleLocationFilter}>
                    <SelectTrigger className="h-8 w-[260px]" aria-label={t('partsList.locationAria')}>
                        <SelectValue placeholder={t('partsList.allLocations')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">{t('partsList.allLocations')}</SelectItem>
                        {warehouseLocations.map((location) => (
                            <SelectItem key={location.id} value={location.name}>
                                {location.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <DataTable
                columns={columns}
                data={pending.rows}
                saveViewTitle={t('partsList.saveViewTitle')}
                dashboardSource={DASHBOARD_WIDGET_SOURCE_INVENTORY}
                {...list.tableProps}
                searchColumn="name"
                searchPlaceholder={t('partsList.searchPlaceholder')}
                columnFilters={columnFilters}
                setColumnFilters={setColumnFilters}
                bulkActions={(selected, { clearSelection, selectOnly }) => (
                    <InventoryBulkActions items={selected} clearSelection={clearSelection} selectOnly={selectOnly} />
                )}
                rowBehaviour={{
                  onRowClick: (item) =>
                    navigate(`/inventory/${item.id}/ledger?sku=${encodeURIComponent(item.sku)}`, {
                      state: { item },
                    }),
                  onRowPrefetch: (item) => {
                    if (!canOpenBackOfficeDetail(role)) return
                    scheduleDetailPrefetch(queryClient, inventoryItemDetailQueryOptions(item.id))
                  },
                }}
                {...tableState}
            />
        </>
    )
}
