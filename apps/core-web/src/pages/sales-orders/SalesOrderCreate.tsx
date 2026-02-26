import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { useCreateSalesOrder } from '@/api/sales-orders'
import { useInventory } from '@/api/inventory'
import { useCustomer } from '@/api/customers'
import { Trash2, Plus, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface SalesOrderItemForm {
    catalog_item_id?: string
    description: string
    quantity: number
    unit_price: number
    tax_rate: number
}

interface SalesOrderForm {
    customer_id: string
    notes: string
    items: SalesOrderItemForm[]
}

export default function SalesOrderCreate() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const preselectedCustomerId = searchParams.get('customerId')
    const createMutation = useCreateSalesOrder()

    // Fetch customer if ID is in URL
    const { data: preselectedCustomer } = useCustomer(preselectedCustomerId || '')

    const form = useForm<SalesOrderForm>({
        defaultValues: {
            customer_id: '',
            notes: '',
            items: [],
        },
    })

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: 'items',
    })

    // Set customer if loaded
    useEffect(() => {
        if (preselectedCustomer) {
            form.setValue('customer_id', preselectedCustomer.id)
        }
    }, [preselectedCustomer, form])

    const onSubmit = async (data: SalesOrderForm) => {
        if (data.items.length === 0) {
            toast.error('Please add at least one item')
            return
        }

        try {
            await createMutation.mutateAsync({
                ...data,
                // Ensure numbers are numbers
                items: data.items.map(item => ({
                    ...item,
                    quantity: Number(item.quantity),
                    unit_price: Number(item.unit_price),
                    tax_rate: Number(item.tax_rate)
                }))
            })
            toast.success('Sales order created')
            navigate('/sales-orders')
        } catch (error) {
            toast.error('Failed to create sales order')
        }
    }

    // Item Search Logic
    const [itemSearchOpen, setItemSearchOpen] = useState(false)
    const [itemSearchQuery, setItemSearchQuery] = useState('')
    const { data: inventory } = useInventory({ search: itemSearchQuery, pageSize: 10 })

    const handleAddItem = (item: any) => {
        append({
            catalog_item_id: item.id,
            description: `${item.sku} - ${item.name}`,
            quantity: 1,
            unit_price: Number(item.price),
            tax_rate: 20 // Default tax
        })
        setItemSearchOpen(false)
    }

    const calculateTotal = (items: SalesOrderItemForm[]) => {
        return items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unit_price)), 0)
    }

    const currentTotal = calculateTotal(form.watch('items'))

    return (
        <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" asChild>
                        <button onClick={() => navigate(-1)}>
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">New Sales Order</h1>
                        <p className="text-slate-500">Create a draft order for a customer.</p>
                    </div>
                </div>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Customer Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <FormField
                                control={form.control}
                                name="customer_id"
                                render={({ field }: { field: any }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Customer</FormLabel>
                                        <FormControl>
                                            <CustomerSearch
                                                value={preselectedCustomer || (field.value ? { id: field.value, type: 'PRIVATE', first_name: 'Loading...', last_name: '', email: '' } as any : null)}
                                                onChange={(customer) => {
                                                    field.onChange(customer?.id)
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="mt-4">
                                <FormField
                                    control={form.control}
                                    name="notes"
                                    render={({ field }: { field: any }) => (
                                        <FormItem>
                                            <FormLabel>Internal Notes</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Order notes..." />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Order Items</CardTitle>
                            <Popover open={itemSearchOpen} onOpenChange={setItemSearchOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline">
                                        <Plus className="mr-2 h-4 w-4" /> Add Item
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[400px] p-0" align="end">
                                    <Command shouldFilter={false}>
                                        <CommandInput placeholder="Search parts by SKU or Name..." value={itemSearchQuery} onValueChange={setItemSearchQuery} />
                                        <CommandList>
                                            <CommandEmpty>No parts found.</CommandEmpty>
                                            <CommandGroup>
                                                {inventory?.data.map((item) => (
                                                    <CommandItem
                                                        key={item.id}
                                                        onSelect={() => handleAddItem(item)}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{item.sku}</span>
                                                            <span className="text-xs text-muted-foreground">{item.name}</span>
                                                        </div>
                                                        <div className="ml-auto font-medium">
                                                            {formatCurrency(item.price)}
                                                        </div>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[40%]">Description</TableHead>
                                        <TableHead className="w-[15%]">Qty</TableHead>
                                        <TableHead className="w-[15%]">Price</TableHead>
                                        <TableHead className="w-[15%]">Total</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {fields.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                                No items added. Click "Add Item" to start.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        fields.map((item, index) => (
                                            <TableRow key={item.id}>
                                                <TableCell>
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.description`}
                                                        render={({ field }: { field: any }) => (
                                                            <Input {...field} />
                                                        )}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.quantity`}
                                                        render={({ field }: { field: any }) => (
                                                            <Input type="number" min="1" {...field} />
                                                        )}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.unit_price`}
                                                        render={({ field }: { field: any }) => (
                                                            <Input type="number" step="0.01" {...field} />
                                                        )}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {formatCurrency(Number(form.watch(`items.${index}.quantity`)) * Number(form.watch(`items.${index}.unit_price`)))}
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                            <div className="p-4 flex justify-end items-center gap-4 border-t bg-slate-50">
                                <span className="text-muted-foreground font-medium">Total Amount:</span>
                                <span className="text-2xl font-bold">{formatCurrency(currentTotal)}</span>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end gap-4">
                        <Button type="button" variant="outline" onClick={() => navigate('/sales-orders')}>
                            Cancel
                        </Button>
                        <Button type="submit" size="lg" disabled={createMutation.isPending}>
                            {createMutation.isPending ? 'Creating...' : 'Create Sales Order'}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
