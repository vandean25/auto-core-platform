import React from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { type ColumnDef } from '@tanstack/react-table'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useInventory } from '@/api/inventory'
import { useBrands } from '@/api/brands'
import type { InventoryItem } from '@/api/types'
import { AddItemDialog } from '@/components/AddItemDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { InventoryItemInfoCard } from '@/components/inventory/InventoryItemInfoCard'
import { DASHBOARD_WIDGET_SOURCE_INVENTORY } from '@/features/dashboard-widgets/sources'

export default function InventoryList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const [selectedItem, setSelectedItem] = React.useState<InventoryItem | null>(null)

    const searchFromNameFilter = queryParams.filters.find((f) => f.field === 'name')?.value
    const { data: responseData, isLoading } = useInventory({
        page: queryParams.page,
        pageSize: queryParams.pageSize,
        search: queryParams.search ?? searchFromNameFilter,
    })
    const { data: brandOptions = [] } = useBrands(
        { isPartManufacturer: true },
        { enabled: selectedItem !== null },
    )

    const data = responseData?.data ?? []
    const pageCount = responseData?.meta.pageCount ?? 1

    const columns: ColumnDef<InventoryItem>[] = [
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'sku',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Part" />,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-bold text-slate-900">{row.original.sku}</span>
                    <span className="text-sm text-slate-500">{row.original.brand}</span>
                </div>
            ),
        },
        {
            accessorKey: 'name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => <span className="text-slate-700">{row.original.name}</span>,
        },
        {
            accessorKey: 'price',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Price" />,
            cell: ({ row }) => {
                const amount = Number(row.getValue('price'))
                return (
                    <div className="font-medium">
                        {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)}
                    </div>
                )
            },
        },
    ]

    return (
        <div className="w-full max-w-page mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
                    <p className="text-slate-500">Manage your automotive parts and stock levels.</p>
                </div>
                <AddItemDialog />
            </div>

            <DataTable
                columns={columns}
                data={data}
                saveViewTitle="Inventory"
                dashboardSource={DASHBOARD_WIDGET_SOURCE_INVENTORY}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="name"
                searchPlaceholder="Search parts..."
                onRowClick={(item) => {
                    setSelectedItem(item)
                }}
                {...tableState}
            />

            <Sheet
                modal={false}
                open={!!selectedItem}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setSelectedItem(null)
                    }
                }}
            >
                <SheetContent
                    side="right"
                    overlayClassName="bg-transparent pointer-events-none"
                    className="w-[90vw] sm:w-[32vw] sm:max-w-[32vw] data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
                    onInteractOutside={(event) => {
                        const target = event.target as HTMLElement | null
                        if (target?.closest('[data-table-row="true"]')) {
                            event.preventDefault()
                        }
                    }}
                >
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.25 } }}
                    >
                        <SheetHeader className="mb-6">
                            <SheetTitle className="text-xl">Item Details</SheetTitle>
                            <SheetDescription>
                                Technical specifications and stock information for {selectedItem?.sku}.
                            </SheetDescription>
                        </SheetHeader>

                        {selectedItem && (
                            <motion.div
                                layoutId="item-info-card"
                                className="relative"
                                transition={{ duration: 0.35, ease: 'easeInOut' }}
                            >
                                <AnimatePresence mode="popLayout" initial={false}>
                                    <motion.div
                                        key={selectedItem.id}
                                        layout
                                        className="w-full"
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
                                        exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
                                    >
                                        <InventoryItemInfoCard
                                            item={selectedItem}
                                            editable
                                            brandOptions={brandOptions}
                                            onChange={(patch) => {
                                                setSelectedItem((prev) => (prev ? { ...prev, ...patch } : prev))
                                            }}
                                            action={
                                                <Button variant="outline" size="sm" asChild>
                                                    <Link
                                                        to={`/inventory/${selectedItem.id}/ledger?sku=${encodeURIComponent(
                                                            selectedItem.sku
                                                        )}`}
                                                        state={{ item: selectedItem }}
                                                    >
                                                        Show Ledger
                                                    </Link>
                                                </Button>
                                            }
                                        />
                                        <p className="mt-3 text-xs text-slate-500">
                                            Changes in this panel are preview-only and are not persisted.
                                        </p>
                                    </motion.div>
                                </AnimatePresence>
                            </motion.div>
                        )}
                    </motion.div>
                </SheetContent>
            </Sheet>
        </div>
    )
}
