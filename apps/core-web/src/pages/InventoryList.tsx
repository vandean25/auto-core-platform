import * as React from 'react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { useInventory } from '@/api/inventory'
import { useLocations } from '@/api/locations'
import type { InventoryItem } from '@/api/types'
import { AddItemDialog } from '@/components/AddItemDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { DASHBOARD_WIDGET_SOURCE_INVENTORY } from '@/features/dashboard-widgets/sources'
import { formatCurrency } from '@/lib/format'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function InventoryList() {
    const { t } = useTranslation('inventory')
    useEffect(() => {
        void ensureNamespaceLoaded('inventory')
    }, [])
    const navigate = useNavigate()
    const { queryParams, columnFilters, setColumnFilters, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

    const searchFromNameFilter = queryParams.filters.find((f) => f.field === 'name')?.value
    const locationFilter = queryParams.filters.find((f) => f.field === 'location')?.value

    const { data: responseData, isLoading } = useInventory({
        page: queryParams.page,
        pageSize: queryParams.pageSize,
        search: queryParams.search ?? searchFromNameFilter,
        location: locationFilter,
        sortField: queryParams.sortField,
        sortDirection: queryParams.sortDirection,
    })
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

    const data = responseData?.data ?? []
    const pageCount = responseData?.meta.pageCount ?? 1

    const columns: ColumnDef<InventoryItem>[] = [
        {
            accessorKey: 'status',
            enableSorting: false,
            meta: { label: t('partsList.columns.status') },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.status')} />,
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'sku',
            meta: { label: t('partsList.columns.part') },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.part')} />,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-bold text-slate-900">{row.original.sku}</span>
                    <span className="text-sm text-slate-500">{row.original.brand}</span>
                </div>
            ),
        },
        {
            accessorKey: 'name',
            meta: { label: t('partsList.columns.description') },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.description')} />,
            cell: ({ row }) => <span className="text-slate-700">{row.original.name}</span>,
        },
        {
            accessorKey: 'warehouse_location',
            enableSorting: false,
            meta: { label: t('partsList.columns.storageLocation') },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.storageLocation')} />,
            cell: ({ row }) => (
                <span className="text-slate-600">{row.original.warehouse_location ?? t('partsList.notAvailable')}</span>
            ),
        },
        {
            accessorKey: 'price',
            meta: { label: t('partsList.columns.price') },
            header: ({ column }) => <DataTableColumnHeader column={column} title={t('partsList.columns.price')} />,
            cell: ({ row }) => {
                const amount = Number(row.getValue('price'))
                return (
                    <div className="font-medium">
                        {formatCurrency(amount)}
                    </div>
                )
            },
        },
    ]

    return (
        <>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{t('partsList.title')}</h1>
                    <p className="text-slate-500">{t('partsList.description')}</p>
                </div>
                <AddItemDialog />
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
                data={data}
                saveViewTitle={t('partsList.saveViewTitle')}
                dashboardSource={DASHBOARD_WIDGET_SOURCE_INVENTORY}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="name"
                searchPlaceholder={t('partsList.searchPlaceholder')}
                columnFilters={columnFilters}
                setColumnFilters={setColumnFilters}
                rowBehaviour={{
                  onRowClick: (item) =>
                    navigate(`/inventory/${item.id}/ledger?sku=${encodeURIComponent(item.sku)}`, {
                      state: { item },
                    }),
                }}
                {...tableState}
            />
        </>
    )
}
