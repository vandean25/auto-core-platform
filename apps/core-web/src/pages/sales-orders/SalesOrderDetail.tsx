import { useParams, Link } from 'react-router-dom'
import { useSalesOrder, useCreateInvoiceFromOrder, useUpdateSalesOrder } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { ArrowLeft, FileText, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/status/StatusBadge'
import { getErrorMessage } from '@/lib/error-utils'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export default function SalesOrderDetail() {
    const { id } = useParams<{ id: string }>()
    const { data: order, isLoading } = useSalesOrder(id!)
    const createInvoiceMutation = useCreateInvoiceFromOrder()
    const updateSalesOrder = useUpdateSalesOrder()

    const handleCreateInvoice = async () => {
        try {
            await createInvoiceMutation.mutateAsync(id!)
            toast.success('Invoice created successfully')
            // Optionally redirect to the new invoice?
            // Since API returns invoice object, we could grab ID but mutation hook might not expose it easily unless we change it.
            // But we invalidate queries so status should update.
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to create invoice'))
        }
    }

    if (isLoading) return <div className="p-8 text-center">Loading order...</div>
    if (!order) return <div className="p-8 text-center">Order not found</div>

    const isLocked = order.status === 'INVOICED'

    const handleSaveNotes = async (nextNotes: string) => {
        if (isLocked) return
        if (nextNotes === (order.notes ?? '')) return

        try {
            await updateSalesOrder.mutateAsync({
                id: order.id,
                data: { notes: nextNotes },
            })
            toast.success('Order notes saved')
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to save order notes'))
            throw error
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" asChild>
                        <Link to="/sales-orders">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
                            {order.order_number}
                            <StatusBadge status={order.status} />
                        </h1>
                        <p className="text-slate-500">
                            Created on {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {order.status !== 'INVOICED' && order.status !== 'DRAFT' && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button size="lg" className="gap-2">
                                    <FileText className="h-4 w-4" /> Create Invoice
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Create Final Invoice?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will finalize the sales order and generate an official invoice number.
                                        You cannot modify the order after this.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleCreateInvoice}>Create Invoice</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    {/* Allow converting DRAFT directly if needed, or require CONFIRMED step first. 
                         For now, let's allow it for any non-invoiced status for flexibility unless business logic forbids. 
                     */}
                    {order.status === 'DRAFT' && (
                        <Button onClick={handleCreateInvoice} size="lg" className="gap-2">
                            <FileText className="h-4 w-4" /> Create Invoice
                        </Button>
                    )}
                    {order.status === 'INVOICED' && (
                        <Button variant="outline" size="lg" className="gap-2" disabled>
                            <CheckCircle2 className="h-4 w-4 text-green-500" /> Invoiced
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="space-y-6 lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Customer</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="font-medium text-lg">
                                {order.customer.type === 'COMPANY'
                                    ? order.customer.company_name
                                    : `${order.customer.first_name} ${order.customer.last_name}`}
                            </div>
                            <div className="text-sm text-muted-foreground mt-2">
                                <div>{order.customer.email}</div>
                                <div>{order.customer.phone}</div>
                            </div>
                            <div className="mt-4 pt-4 border-t text-sm">
                                <div>{order.customer.address_street}</div>
                                <div>{order.customer.address_zip} {order.customer.address_city}</div>
                                <div>{order.customer.address_country}</div>
                            </div>
                            <Button variant="link" className="px-0 mt-2" asChild>
                                <Link to={`/customers/${order.customer.id}`}>View Profile</Link>
                            </Button>
                        </CardContent>
                    </Card>

                    {order.vehicle && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base font-semibold">Vehicle</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="font-medium">{order.vehicle.make} {order.vehicle.model}</div>
                                <div className="text-sm text-muted-foreground">{order.vehicle.year}</div>
                                <div className="mt-2 text-sm">VIN: {order.vehicle.vin}</div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Notes</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <InlineEdit
                                mode="textarea"
                                rows={5}
                                value={order.notes ?? ''}
                                onSave={handleSaveNotes}
                                placeholder="Order notes..."
                                emptyText="Add notes"
                                readOnly={isLocked}
                                ariaLabel="Sales order notes"
                            />
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Order Items</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Description</TableHead>
                                        <TableHead>Qty</TableHead>
                                        <TableHead>Price</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {order.items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                                                No items on this order.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        order.items.map((item) => (
                                            <TableRow key={item.id}>
                                                <TableCell>
                                                    <div className="font-medium">{item.description}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {item.catalog_item?.sku}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{Number(item.quantity)}</TableCell>
                                                <TableCell>{formatCurrency(Number(item.unit_price))}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(Number(item.total))}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                            <div className="p-4 flex justify-end items-center gap-4 border-t bg-slate-50">
                                <span className="text-muted-foreground font-medium">Total Amount:</span>
                                <span className="text-2xl font-bold">{formatCurrency(Number(order.total_amount))}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
