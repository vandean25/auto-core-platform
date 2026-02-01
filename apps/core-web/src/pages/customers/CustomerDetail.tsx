import { useParams, Link } from 'react-router-dom'
import { useCustomer } from '@/api/customers'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Phone, Mail, MapPin, ArrowLeft, Plus } from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

export default function CustomerDetail() {
    const { id } = useParams<{ id: string }>()
    const { data: customer, isLoading } = useCustomer(id!)

    if (isLoading) {
        return <div className="p-8 text-center">Loading customer details...</div>
    }

    if (!customer) {
        return <div className="p-8 text-center">Customer not found.</div>
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link to="/customers">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        {customer.type === 'COMPANY' ? customer.company_name : `${customer.first_name} ${customer.last_name}`}
                    </h1>
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        {customer.type === 'COMPANY' && <Badge variant="outline">Company</Badge>}
                        <span>ID: {customer.id.substring(0, 8)}</span>
                    </div>
                </div>
                <div className="ml-auto flex gap-2">
                    <Button asChild>
                         <Link to={`/sales-orders/new?customerId=${customer.id}`}>
                            <Plus className="mr-2 h-4 w-4" /> New Order
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle>Contact Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a>
                        </div>
                        {customer.phone && (
                             <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a>
                            </div>
                        )}
                        <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
                            <div>
                                <div>{customer.address_street}</div>
                                <div>{customer.address_zip} {customer.address_city}</div>
                                <div>{customer.address_country}</div>
                            </div>
                        </div>
                        {customer.vat_id && (
                             <div className="pt-2 border-t">
                                <span className="text-sm font-medium">VAT ID:</span> <span className="text-sm text-muted-foreground">{customer.vat_id}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="md:col-span-2">
                     <Tabs defaultValue="orders">
                        <TabsList>
                            <TabsTrigger value="orders">Active Orders</TabsTrigger>
                            <TabsTrigger value="invoices">Invoice History</TabsTrigger>
                            <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
                        </TabsList>
                        <TabsContent value="orders" className="mt-4">
                            <Card>
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Order #</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {/* We need to fetch this data properly via relation or separate query. 
                                                Assuming 'customer' object from API includes some relations or we create a new hook.
                                                For this turn, assuming minimal relation data or empty state if not included.
                                                The backend findOne includes: vehicles, sales_orders (take 5), invoices (take 5).
                                            */}
                                            {(customer as any).sales_orders?.map((order: any) => (
                                                <TableRow key={order.id}>
                                                    <TableCell className="font-medium">
                                                        <Link to={`/sales-orders/${order.id}`} className="hover:underline">
                                                            {order.order_number}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                                                    <TableCell><Badge variant="secondary">{order.status}</Badge></TableCell>
                                                    <TableCell className="text-right">{formatCurrency(Number(order.total_amount))}</TableCell>
                                                </TableRow>
                                            ))}
                                            {(!((customer as any).sales_orders) || (customer as any).sales_orders.length === 0) && (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No recent orders</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>
                        <TabsContent value="invoices" className="mt-4">
                             <Card>
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Invoice #</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                             {(customer as any).invoices?.map((invoice: any) => (
                                                <TableRow key={invoice.id}>
                                                    <TableCell className="font-medium">{invoice.invoice_number || 'Draft'}</TableCell>
                                                    <TableCell>{new Date(invoice.date).toLocaleDateString()}</TableCell>
                                                    <TableCell><Badge variant="outline">{invoice.status}</Badge></TableCell>
                                                    <TableCell className="text-right">{formatCurrency(Number(invoice.total_gross))}</TableCell>
                                                </TableRow>
                                            ))}
                                             {(!((customer as any).invoices) || (customer as any).invoices.length === 0) && (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No recent invoices</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>
                        <TabsContent value="vehicles" className="mt-4">
                            <Card>
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Make/Model</TableHead>
                                                <TableHead>Year</TableHead>
                                                <TableHead>VIN</TableHead>
                                                <TableHead>Plate</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                             {(customer as any).vehicles?.map((vehicle: any) => (
                                                <TableRow key={vehicle.id}>
                                                    <TableCell className="font-medium">{vehicle.make} {vehicle.model}</TableCell>
                                                    <TableCell>{vehicle.year}</TableCell>
                                                    <TableCell>{vehicle.vin}</TableCell>
                                                    <TableCell>{vehicle.plate}</TableCell>
                                                </TableRow>
                                            ))}
                                             {(!((customer as any).vehicles) || (customer as any).vehicles.length === 0) && (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No vehicles registered</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    )
}
