import { useState } from 'react'
import { useSalesOrders } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, FileText, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'

export default function SalesOrderList() {
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const { data: orders, isLoading } = useSalesOrders(
        statusFilter === 'all' ? undefined : statusFilter as any
    )

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'DRAFT': return 'bg-slate-500'
            case 'CONFIRMED': return 'bg-blue-500'
            case 'IN_PROGRESS': return 'bg-orange-500'
            case 'COMPLETED': return 'bg-green-500'
            case 'INVOICED': return 'bg-purple-500'
            default: return 'bg-slate-500'
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Sales Orders</h1>
                    <p className="text-muted-foreground">
                        Manage your sales pipeline and job cards.
                    </p>
                </div>
                <Button asChild>
                    <Link to="/sales-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> New Order
                    </Link>
                </Button>
            </div>

            <Tabs defaultValue="all" onValueChange={setStatusFilter}>
                <TabsList>
                    <TabsTrigger value="all">All Orders</TabsTrigger>
                    <TabsTrigger value="DRAFT">Draft</TabsTrigger>
                    <TabsTrigger value="IN_PROGRESS">In Progress</TabsTrigger>
                    <TabsTrigger value="COMPLETED">Completed</TabsTrigger>
                    <TabsTrigger value="INVOICED">Invoiced</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Vehicle</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-8">
                                    Loading orders...
                                </TableCell>
                            </TableRow>
                        ) : orders?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                    No sales orders found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders?.map((order) => (
                                <TableRow key={order.id}>
                                    <TableCell className="font-medium">{order.order_number}</TableCell>
                                    <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        {order.customer.type === 'COMPANY' 
                                            ? order.customer.company_name 
                                            : `${order.customer.first_name} ${order.customer.last_name}`}
                                    </TableCell>
                                    <TableCell>
                                        {order.vehicle ? `${order.vehicle.make} ${order.vehicle.model}` : '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={getStatusColor(order.status)}>
                                            {order.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        {formatCurrency(Number(order.total_amount))}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" asChild>
                                            <Link to={`/sales-orders/${order.id}`}>
                                                Details <ArrowRight className="ml-2 h-4 w-4" />
                                            </Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
