import { useState } from 'react'
import { useCustomers, useDeleteCustomer } from '@/api/customers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { CustomerDialog } from '@/components/customers/CustomerDialog'
import { Plus, Search, Trash2, Edit2, User, Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

export default function CustomerList() {
    const [search, setSearch] = useState('')
    const { data: customers, isLoading } = useCustomers(search)
    const deleteMutation = useDeleteCustomer()
    const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
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

    const handleEdit = (customer: any) => {
        setSelectedCustomer(customer)
        setIsDialogOpen(true)
    }

    const handleCreate = () => {
        setSelectedCustomer(undefined)
        setIsDialogOpen(true)
    }

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

            <div className="flex items-center space-x-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search customers..."
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]"></TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8">
                                    Loading customers...
                                </TableCell>
                            </TableRow>
                        ) : customers?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                    No customers found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            customers?.map((customer) => (
                                <TableRow key={customer.id}>
                                    <TableCell>
                                        {customer.type === 'COMPANY' ? (
                                            <Building2 className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <User className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium">
                                            {customer.type === 'COMPANY' ? customer.company_name : `${customer.first_name} ${customer.last_name}`}
                                        </div>
                                        {customer.type === 'COMPANY' && (
                                            <div className="text-xs text-muted-foreground">
                                                {customer.first_name} {customer.last_name}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col text-sm">
                                            <span>{customer.email}</span>
                                            <span className="text-muted-foreground">{customer.phone}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-sm">
                                            {customer.address_city} {customer.address_country}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(customer)}>
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(customer.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <CustomerDialog 
                open={isDialogOpen} 
                onOpenChange={setIsDialogOpen} 
                customer={selectedCustomer} 
            />
        </div>
    )
}
