import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useVendors } from '@/api/vendors'
import { Button } from '@/components/ui/button'
import { VendorDialog } from './VendorDialog'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Vendor } from '@/api/types'

export default function VendorList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useVendors(queryParams)
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    const data = Array.isArray(responseData) ? responseData : (responseData as any)?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : (responseData as any)?.meta?.pageCount || 1

    const columns: ColumnDef<Vendor>[] = [
        {
            accessorKey: 'name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
            cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        },
        {
            accessorKey: 'email',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        },
        {
            accessorKey: 'account_number',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Account #" />,
        },
        {
            accessorKey: 'supportedBrands',
            header: 'Supported Brands',
            enableSorting: false,
            cell: ({ row }) => (
                <div className="flex flex-wrap gap-1">
                    {row.original.supportedBrands?.map((brand) => (
                        <Badge key={brand.id} variant="outline">
                            {brand.name}
                        </Badge>
                    ))}
                </div>
            ),
        },
    ]

    return (
        <div className="p-8 space-y-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Vendors</h1>
                <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Add Vendor
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="name"
                searchPlaceholder="Search vendors..."
                {...tableState}
            />

            <VendorDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
        </div>
    )
}
