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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { format } from 'date-fns'
import { useState } from 'react'

export default function PurchaseOrderList() {
    const [viewMode, setViewMode] = useState('open')
    const { data: orders, isLoading, error } = usePurchaseOrders(viewMode)

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

            <Tabs value={viewMode} onValueChange={setViewMode} className="w-full">
                <TabsList>
                    <TabsTrigger value="open">Open Orders</TabsTrigger>
                    <TabsTrigger value="all">All History</TabsTrigger>
                </TabsList>
                
                <div className="rounded-md border mt-4">
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
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8">
                                        Loading orders...
                                    </TableCell>
                                </TableRow>
                            ) : orders?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8">
                                        {viewMode === 'open' 
                                            ? "All caught up! No active orders."
                                            : "No orders found."}
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
            </Tabs>
        </div>
    )
}
