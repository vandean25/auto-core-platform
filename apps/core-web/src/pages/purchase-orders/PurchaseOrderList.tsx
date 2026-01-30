import { usePurchaseOrders } from '@/api/purchase-orders'
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
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { format } from 'date-fns'

export default function PurchaseOrderList() {
    const { data: orders, isLoading, error } = usePurchaseOrders()

    if (isLoading) return <div>Loading orders...</div>
    if (error) return <div>Error loading orders</div>

    return (
        <div className="p-8 space-y-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Purchase Orders</h1>
                <Button asChild>
                    <Link to="/purchase-orders/new">
                        <Plus className="mr-2 h-4 w-4" /> Create PO
                    </Link>
                </Button>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Vendor</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Items</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {orders?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center">
                                    No orders found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders?.map((po) => (
                                <TableRow key={po.id} className="cursor-pointer hover:bg-muted/50">
                                    <TableCell className="font-medium">
                                        <Link to={`/purchase-orders/${po.id}`} className="hover:underline">
                                            {po.order_number}
                                        </Link>
                                    </TableCell>
                                    <TableCell>{po.vendor?.name}</TableCell>
                                    <TableCell>
                                        <Badge variant={
                                            po.status === 'COMPLETED' ? 'default' :
                                                po.status === 'PARTIAL' ? 'secondary' : 'outline'
                                        }>
                                            {po.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{format(new Date(po.createdAt), 'PPP')}</TableCell>
                                    <TableCell className="text-right">{po.items?.length || 0}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
