import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useNavigate } from 'react-router-dom'
import { useDeleteVendor, useVendors } from '@/api/vendors'
import { Button } from '@/components/ui/button'
import { VendorDialog } from './VendorDialog'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Vendor } from '@/api/types'
import { toast } from 'sonner'

export default function VendorList() {
    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useVendors(queryParams)
    const deleteMutation = useDeleteVendor()
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    const data = Array.isArray(responseData) ? responseData : (responseData as any)?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : (responseData as any)?.meta?.pageCount || 1

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this vendor?')) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Vendor deleted')
        } catch (error: any) {
            toast.error(error?.message || 'Failed to delete vendor')
        }
    }

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
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
                    <p className="text-slate-500">Manage your suppliers and service providers.</p>
                </div>
                <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Vendor
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={data}
                pageCount={pageCount}
                isLoading={isLoading}
                searchColumn="name"
                searchPlaceholder="Search vendors..."
                onRowClick={(row) => navigate(`/vendors/${row.id}`)}
                getRowContextActions={(row) => [
                    {
                        label: 'Delete',
                        onClick: () => void handleDelete(row.id),
                        destructive: true,
                    },
                ]}
                {...tableState}
            />

            <VendorDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
        </div>
    )
}
