import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { type ColumnDef } from "@tanstack/react-table"
import { useCustomers, useDeleteCustomer } from '@/api/customers'
import type { Customer } from '@/api/types'
import { Button } from '@/components/ui/button'
import { CustomerDialog } from '@/components/customers/CustomerDialog'
import { Plus, User, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { DASHBOARD_WIDGET_SOURCE_CUSTOMERS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'

export default function CustomerList() {
    const navigate = useNavigate()
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useCustomers(queryParams)
    const [searchParams, setSearchParams] = useSearchParams()

    // Handle both legacy array response and new paginated response
    const customers: Customer[] = Array.isArray(responseData) ? responseData : responseData?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount || 1

    const deleteMutation = useDeleteCustomer()
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>(undefined)
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            // Use setTimeout to avoid synchronous state updates during render phase
            // which can cause cascading renders and trigger linter errors
            setTimeout(() => {
                setSelectedCustomer(undefined)
                setIsDialogOpen(true)

                // Optional: clean up the URL
                const newParams = new URLSearchParams(searchParams)
                newParams.delete('action')
                setSearchParams(newParams, { replace: true })
            }, 0)
        }
    }, [searchParams, setSearchParams])

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this customer?')) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Customer deleted')
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to delete customer'))
        }
    }

    const handleCreate = () => {
        setSelectedCustomer(undefined)
        setIsDialogOpen(true)
    }

    const columns: ColumnDef<Customer>[] = [
        {
            id: "icon",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="" className="w-[50px]" />
            ),
            cell: ({ row }) => (
                <div className="w-[50px]">
                    {row.original.type === 'COMPANY' ? (
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <User className="h-4 w-4 text-muted-foreground" />
                    )}
                </div>
            ),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: "company_name", // Fallback accessor, we use cell mostly
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Name" />
            ),
            cell: ({ row }) => (
                <div>
                    <div className="font-medium">
                        {row.original.type === 'COMPANY' ? row.original.company_name : `${row.original.first_name} ${row.original.last_name}`}
                    </div>
                    {row.original.type === 'COMPANY' && (
                        <div className="text-xs text-muted-foreground">
                            {row.original.first_name} {row.original.last_name}
                        </div>
                    )}
                </div>
            ),
        },
        {
            accessorKey: "email",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Contact" />
            ),
            cell: ({ row }) => (
                <div className="flex flex-col text-sm">
                    <span>{row.original.email}</span>
                    <span className="text-muted-foreground">{row.original.phone}</span>
                </div>
            ),
        },
        {
            accessorKey: "address_city",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Location" />
            ),
            cell: ({ row }) => (
                <div className="text-sm">
                    {row.original.address_city} {row.original.address_country}
                </div>
            ),
        },
    ]

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
                    <p className="text-slate-500">Manage your customer database and CRM.</p>
                </div>
                <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" /> Customer
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={customers}
                saveViewTitle="Customers"
                dashboardSource={DASHBOARD_WIDGET_SOURCE_CUSTOMERS}
                pageCount={pageCount}
                isLoading={isLoading}
                searchPlaceholder="Search customers..."
                onRowClick={(row) => navigate(`/customers/${row.id}`)}
                getRowContextActions={(row) => [
                    {
                        label: "Delete",
                        onClick: () => void handleDelete(row.id),
                        destructive: true,
                    },
                ]}
                {...tableState}
            />

            <CustomerDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                customer={selectedCustomer}
            />
        </div>
    )
}
