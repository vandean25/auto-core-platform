import { useState } from 'react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useCustomers, useDeleteCustomer } from '@/api/customers'
import type { Customer } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { CustomerDialog } from '@/components/customers/CustomerDialog'
import { Plus, Trash2, Edit2, User, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'

export default function CustomerList() {
    const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
    const { data: responseData, isLoading } = useCustomers(queryParams)
    
    // Handle both legacy array response and new paginated response
    const customers: Customer[] = Array.isArray(responseData) ? responseData : responseData?.data || []
    const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount || 1

    const deleteMutation = useDeleteCustomer()
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>(undefined)
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this customer?')) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Customer deleted')
        } catch (error) {
            toast.error('Failed to delete customer')
        }
    }

    const handleEdit = (customer: Customer) => {
        setSelectedCustomer(customer)
        setIsDialogOpen(true)
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
        {
            id: "actions",
            cell: ({ row }) => (
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
                        <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(row.original.id)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ),
        },
    ]

    const table = useReactTable({
        data: customers,
        columns,
        state: {
            columnFilters: tableState.columnFilters,
            sorting: tableState.sorting,
            pagination: tableState.pagination,
        },
        pageCount: pageCount,
        onColumnFiltersChange: tableState.setColumnFilters,
        onSortingChange: tableState.setSorting,
        onPaginationChange: tableState.setPagination,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
    })

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
                    <p className="text-muted-foreground">
                        Manage your customer database and CRM.
                    </p>
                </div>
                <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" /> Add Customer
                </Button>
            </div>

            <DataTableToolbar table={table} searchColumn="company_name" placeholder="Search customers..." />

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="text-center py-8">
                                    Loading customers...
                                </TableCell>
                            </TableRow>
                        ) : table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                >
                    Previous
                </Button>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <span>Page</span>
                    <span className="font-medium">{table.getState().pagination.pageIndex + 1}</span>
                    <span>of</span>
                    <span className="font-medium">{table.getPageCount()}</span>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                >
                    Next
                </Button>
            </div>

            <CustomerDialog 
                open={isDialogOpen} 
                onOpenChange={setIsDialogOpen} 
                customer={selectedCustomer} 
            />
        </div>
    )
}