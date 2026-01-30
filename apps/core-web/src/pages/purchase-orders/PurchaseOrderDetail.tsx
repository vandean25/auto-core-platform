import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePurchaseOrder, useReceiveGoods } from '@/api/purchase-orders'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from "sonner"
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
import { getPOStatusVariant } from '@/lib/utils'
import type { PurchaseOrder, PurchaseOrderItem } from '@/api/types'

export default function PurchaseOrderDetail() {
    const { id } = useParams<{ id: string }>()
    const { data: po, isLoading, error } = usePurchaseOrder(id!)
    const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false)

    if (isLoading) return <div>Loading order...</div>
    if (error) return <div>Error loading order</div>
    if (!po) return <div>Order not found</div>

    return (
        <div className="p-8 space-y-8">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold">{po.order_number}</h1>
                    <p className="text-muted-foreground">Vendor: {po.vendor?.name}</p>
                </div>
                <div className="flex items-center space-x-4">
                    <Badge className="text-lg px-4 py-1" variant={getPOStatusVariant(po.status)}>
                        {po.status}
                    </Badge>
                    {po.status !== 'COMPLETED' && (
                        <Button onClick={() => setIsReceiveDialogOpen(true)}>
                            Receive Goods
                        </Button>
                    )}
                </div>
            </div>

            <div className="border rounded-md">
                <Table>
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
                                <TableCell className="text-right">${item.unit_cost}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
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
