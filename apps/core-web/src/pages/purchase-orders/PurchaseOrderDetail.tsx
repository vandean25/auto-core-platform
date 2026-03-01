import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePurchaseOrder, useReceiveGoods } from '@/api/purchase-orders'
import { useUnbilledReceipts } from '@/api/usePurchaseInvoices'
import { Button } from '@/components/ui/button'
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { PurchaseOrder, PurchaseOrderItem } from '@/api/types'
import { Receipt } from "lucide-react"

export default function PurchaseOrderDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { data: po, isLoading, error } = usePurchaseOrder(id!)
    const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false)

    // Fetch unbilled receipts for this vendor to calculate count related to this PO
    const { data: unbilledItems = [] } = useUnbilledReceipts(po?.vendor_id)

    // Filter unbilled items for this specific PO
    const poUnbilledCount = unbilledItems.filter(item => item.purchaseOrderNumber === po?.order_number).length

    if (isLoading) return <div>Loading order...</div>
    if (error) return <div>Error loading order</div>
    if (!po) return <div>Order not found</div>

    return (
        <div className="w-full max-w-7xl mx-auto p-6 space-y-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{po.order_number}</h1>
                    <p className="text-slate-500">Vendor: {po.vendor?.name}</p>
                </div>
                <div className="flex items-center space-x-4">
                    <StatusBadge status={po.status} />

                    <Button
                        variant="outline"
                        disabled={poUnbilledCount === 0}
                        onClick={() => navigate(`/purchase-invoices/new?vendorId=${po.vendor_id}&poId=${po.id}`)}
                    >
                        <Receipt className="mr-2 h-4 w-4" />
                        Create Bill ({poUnbilledCount} items)
                    </Button>

                    {po.status !== 'COMPLETED' && (
                        <Button onClick={() => setIsReceiveDialogOpen(true)}>
                            Receive Goods
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="space-y-6 lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Purchase Order</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div>
                                <div className="text-muted-foreground">Order #</div>
                                <div className="font-medium">{po.order_number}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Created</div>
                                <div className="font-medium">{new Date(po.createdAt).toLocaleDateString()}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Items</div>
                                <div className="font-medium">{po.items.length}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Unbilled Receipts</div>
                                <div className="font-medium">{poUnbilledCount} items</div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Vendor</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="font-medium">{po.vendor?.name}</div>
                            {po.vendor?.email && <div className="text-muted-foreground">{po.vendor.email}</div>}
                            {po.vendor?.account_number && (
                                <div className="text-muted-foreground">Account: {po.vendor.account_number}</div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Line Items</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table className="min-w-[700px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>SKU</TableHead>
                                        <TableHead>Item</TableHead>
                                        <TableHead className="text-right">Ordered</TableHead>
                                        <TableHead className="text-right">Received</TableHead>
                                        <TableHead className="text-right">Remaining</TableHead>
                                        <TableHead className="text-right">Cost</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {po.items.map((item: PurchaseOrderItem) => (
                                        <TableRow key={item.id}>
                                            <TableCell>{item.catalog_item?.sku || 'N/A'}</TableCell>
                                            <TableCell>{item.catalog_item?.name || 'Unknown Item'}</TableCell>
                                            <TableCell className="text-right">{item.quantity}</TableCell>
                                            <TableCell className="text-right text-green-600 font-medium">
                                                {item.quantity_received}
                                            </TableCell>
                                            <TableCell className="text-right text-orange-600">
                                                {item.quantity - item.quantity_received}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {item.unit_cost === null || item.unit_cost === undefined
                                                    ? '—'
                                                    : formatCurrency(item.unit_cost)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <ReceiveGoodsDialog
                open={isReceiveDialogOpen}
                onOpenChange={setIsReceiveDialogOpen}
                po={po}
            />
        </div>
    )
}

function ReceiveGoodsDialog({ open, onOpenChange, po }: { open: boolean; onOpenChange: (o: boolean) => void; po: PurchaseOrder }) {
    const [receiveQuantities, setReceiveQuantities] = useState<Record<string, number>>({})
    const receiveGoods = useReceiveGoods()

    const handleQuantityChange = (itemId: string, qty: number) => {
        setReceiveQuantities(prev => ({ ...prev, [itemId]: qty }))
    }

    const handleSubmit = () => {
        const itemsToReceive = Object.entries(receiveQuantities)
            .filter(([, qty]) => qty > 0)
            .map(([itemId, quantity]) => ({ itemId, quantity }))

        if (itemsToReceive.length === 0) return

        receiveGoods.mutate({ orderId: po.id, items: itemsToReceive }, {
            onSuccess: () => {
                onOpenChange(false)
                setReceiveQuantities({})
            },
            onError: (error) => {
                toast.error("Failed to receive goods", {
                    description: error.message
                })
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Receive Goods for {po.order_number}</DialogTitle>
                </DialogHeader>

                <div className="py-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-right">Remaining</TableHead>
                                <TableHead className="w-[150px] text-right">Receive Now</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {po.items.map((item: PurchaseOrderItem) => {
                                const remaining = item.quantity - item.quantity_received
                                if (remaining <= 0) return null

                                return (
                                    <TableRow key={item.catalog_item_id}>
                                        <TableCell>
                                            <div className="font-medium">{item.catalog_item?.sku}</div>
                                            <div className="text-sm text-muted-foreground">{item.catalog_item?.name}</div>
                                        </TableCell>
                                        <TableCell className="text-right">{remaining}</TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                min="0"
                                                max={remaining}
                                                className="text-right"
                                                placeholder="0"
                                                value={receiveQuantities[item.catalog_item_id] || ''}
                                                onChange={(e) => handleQuantityChange(item.catalog_item_id, parseInt(e.target.value) || 0)}
                                            />
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={receiveGoods.isPending}>
                        {receiveGoods.isPending ? 'Processing...' : 'Confirm Receipt'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
