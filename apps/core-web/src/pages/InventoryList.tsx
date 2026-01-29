import React from 'react'
import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { useInventory } from '@/api/inventory'
import type { InventoryItem, InventoryStatus } from '@/api/types'
import { cn } from '@/lib/utils'
import { Inbox } from 'lucide-react'

const StatusDot = ({ status }: { status: InventoryStatus }) => {
    const colors = {
        IN_STOCK: 'bg-green-500',
        OUT_OF_STOCK: 'bg-red-500',
        SUPERSEDED: 'bg-orange-500',
    }

    return (
        <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', colors[status])} />
            <span className="capitalize">{status.replace('_', ' ').toLowerCase()}</span>
        </div>
    )
}

const EmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Inbox className="h-12 w-12 mb-4 stroke-[1.5]" />
        <p className="text-lg font-medium">No items found</p>
        <p className="text-sm">Try adjusting your filters or search terms.</p>
    </div>
)

export default function InventoryList() {
    const { data, isLoading } = useInventory({ limit: 50 })
    const [selectedItem, setSelectedItem] = React.useState<InventoryItem | null>(null)

    const columns: ColumnDef<InventoryItem>[] = [
        {
            accessorKey: 'status',
            header: 'STATUS',
            cell: ({ row }) => <StatusDot status={row.original.status} />,
        },
        {
            accessorKey: 'part',
            header: 'PART',
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-bold text-slate-900">{row.original.sku}</span>
                    <span className="text-sm text-slate-500">{row.original.brand}</span>
                </div>
            ),
        },
        {
            accessorKey: 'name',
            header: 'DESCRIPTION',
            cell: ({ row }) => <span className="text-slate-700">{row.original.name}</span>,
        },
        {
            accessorKey: 'price',
            header: () => <div className="text-right">PRICE</div>,
            cell: ({ row }) => {
                const amount = parseFloat(row.getValue('price'))
                const formatted = new Intl.NumberFormat('de-DE', {
                    style: 'currency',
                    currency: 'EUR',
                }).format(amount)

                return <div className="text-right font-medium">{formatted}</div>
            },
        },
    ]

    const table = useReactTable({
        data: data?.data || [],
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    if (isLoading) {
        return <div className="p-8 text-center text-slate-500">Loading inventory...</div>
    }

    const isEmpty = !data || data.data.length === 0

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="mb-8">
                <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
                <p className="text-slate-500">Manage your automotive parts and stock levels.</p>
            </div>

            <div className="rounded-md border border-slate-100 bg-white overflow-hidden">
                {isEmpty ? (
                    <EmptyState />
                ) : (
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id} className="hover:bg-transparent border-slate-100">
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            className="h-10 text-xs font-medium text-slate-500 uppercase tracking-wider px-6"
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    onClick={() => setSelectedItem(row.original)}
                                    className="h-16 cursor-pointer hover:bg-slate-50/50 border-slate-100 transition-colors"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="px-6">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <Sheet open={!!selectedItem} onOpenChange={(open: boolean) => !open && setSelectedItem(null)}>
                <SheetContent className="sm:max-w-md">
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-xl">Item Details</SheetTitle>
                        <SheetDescription>
                            Technical specifications and stock information for {selectedItem?.sku}.
                        </SheetDescription>
                    </SheetHeader>

                    {selectedItem && (
                        <div className="space-y-6">
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
                                        <StatusDot status={selectedItem.status} />
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
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    )
}
