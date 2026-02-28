import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useInventory } from '@/api/inventory'
import type { InventoryItem } from '@/api/types'
import StockTimeline from '@/components/inventory/StockTimeline'
import { AddItemDialog } from '@/components/AddItemDialog'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'

export default function InventoryList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

    const searchFromNameFilter = queryParams.filters.find((f) => f.field === 'name')?.value
    const { data: responseData, isLoading } = useInventory({
        page: queryParams.page,
        pageSize: queryParams.pageSize,
        search: queryParams.search ?? searchFromNameFilter,
    })
    const [selectedItem, setSelectedItem] = React.useState<InventoryItem | null>(null)
    const [showLedger, setShowLedger] = React.useState(false)

    const data = (responseData as any)?.data || []
    const pageCount = (responseData as any)?.meta?.pageCount || 1

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
                const amount = parseFloat(row.getValue('price'))
                const formatted = new Intl.NumberFormat('de-DE', {
                    style: 'currency',
                    currency: 'EUR',
                }).format(amount)

                return <div className="font-medium">{formatted}</div>
            },
        },
    ]

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
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
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="name"
                searchPlaceholder="Search parts..."
                onRowClick={(item) => {
                    setSelectedItem(item)
                    setShowLedger(false)
                }}
                {...tableState}
            />

            <Sheet
                open={!!selectedItem}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setSelectedItem(null)
                        setShowLedger(false)
                    }
                }}
            >
                <SheetContent className="sm:max-w-5xl">
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-xl">Item Details</SheetTitle>
                        <SheetDescription>
                            Technical specifications and stock information for {selectedItem?.sku}.
                        </SheetDescription>
                    </SheetHeader>

                    {selectedItem && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                            <div className="space-y-6 lg:col-span-1">
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                                        <CardTitle className="text-base font-semibold">Item Info</CardTitle>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowLedger((prev) => !prev)}
                                        >
                                            {showLedger ? 'Hide Ledger' : 'Show Ledger'}
                                        </Button>
                                    </CardHeader>
                                    <CardContent className="space-y-4 text-sm">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-slate-500 uppercase">SKU</p>
                                                <p className="font-semibold">{selectedItem.sku}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-slate-500 uppercase">Brand</p>
                                                <p className="font-semibold">{selectedItem.brand}</p>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <p className="text-xs font-medium text-slate-500 uppercase">Name</p>
                                            <p>{selectedItem.name}</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-slate-500 uppercase">Price</p>
                                                <p className="text-lg font-bold">
                                                    {new Intl.NumberFormat('de-DE', {
                                                        style: 'currency',
                                                        currency: 'EUR',
                                                    }).format(selectedItem.price)}
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-slate-500 uppercase">Availability</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <StatusBadge status={selectedItem.status} />
                                                    <span className="text-sm font-medium">
                                                        ({selectedItem.quantity_available} units)
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {selectedItem.category && (
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-slate-500 uppercase">Category</p>
                                                <Badge variant="secondary" className="mt-1">
                                                    {selectedItem.category}
                                                </Badge>
                                            </div>
                                        )}

                                        {selectedItem.warehouse_location && (
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-slate-500 uppercase">Location</p>
                                                <p className="text-sm text-slate-600 font-medium">
                                                    {selectedItem.warehouse_location}
                                                </p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="lg:col-span-2">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base font-semibold">Stock Ledger</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        {!showLedger && (
                                            <div className="text-sm text-muted-foreground">
                                                Click &quot;Show Ledger&quot; to view recent stock movements.
                                            </div>
                                        )}
                                        <div
                                            className={`transition-all duration-300 ${
                                                showLedger
                                                    ? 'opacity-100 translate-y-0'
                                                    : 'opacity-0 -translate-y-2 pointer-events-none h-0 overflow-hidden'
                                            }`}
                                        >
                                            <StockTimeline itemId={selectedItem.id} />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    )
}
