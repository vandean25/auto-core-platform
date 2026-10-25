import * as React from "react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { UnbilledReceiptItem } from "@/api/types"
import { formatCurrency } from "@/lib/format"
import { ensureNamespaceLoaded } from "@/lib/i18n"

interface UnbilledReceiptsModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    items: UnbilledReceiptItem[]
    onAdd: (selectedItems: { item: UnbilledReceiptItem; quantity: number }[]) => void
    preSelectPoId?: string | null
}

export function UnbilledReceiptsModal({ open, onOpenChange, items, onAdd, preSelectPoId }: UnbilledReceiptsModalProps) {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const [selected, setSelected] = React.useState<Record<string, boolean>>({})
    const [quantities, setQuantities] = React.useState<Record<string, number>>({})

    React.useEffect(() => {
        if (open) {
            const initialSelected: Record<string, boolean> = {}
            const initialQtys: Record<string, number> = {}
            
            items.forEach(item => {
                initialQtys[item.purchaseOrderItemId] = item.quantityPending
                
                if (preSelectPoId && item.purchaseOrderId === preSelectPoId) {
                    initialSelected[item.purchaseOrderItemId] = true
                }
            })
            setQuantities(initialQtys)
            setSelected(initialSelected)
        }
    }, [open, items, preSelectPoId])

    const toggleSelect = (id: string, checked: boolean) => {
        setSelected(prev => ({ ...prev, [id]: checked }))
    }

    const updateQuantity = (id: string, qty: number, max: number) => {
        if (qty > max) qty = max
        if (qty < 0) qty = 0
        setQuantities(prev => ({ ...prev, [id]: qty }))
    }

    const handleSelectAll = (checked: boolean) => {
        const newSelected: Record<string, boolean> = {}
        if (checked) {
            items.forEach(item => newSelected[item.purchaseOrderItemId] = true)
        }
        setSelected(newSelected)
    }

    const handleAdd = () => {
        const result = items
            .filter(item => selected[item.purchaseOrderItemId])
            .map(item => ({
                item,
                quantity: quantities[item.purchaseOrderItemId] || item.quantityPending
            }))
            .filter(i => i.quantity > 0)
        
        onAdd(result)
        onOpenChange(false)
    }

    const allSelected = items.length > 0 && items.every(i => selected[i.purchaseOrderItemId])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] max-w-4xl flex flex-col gap-0 overflow-hidden p-0">
                <DialogHeader className="shrink-0 px-6 pt-6">
                    <DialogTitle>{t('purchaseInvoices.unbilledModal.title')}</DialogTitle>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]">
                                    <Checkbox 
                                        checked={allSelected} 
                                        onCheckedChange={(c) => handleSelectAll(!!c)} 
                                    />
                                </TableHead>
                                <TableHead>{t('columns.poNumber')}</TableHead>
                                <TableHead>{t('columns.item')}</TableHead>
                                <TableHead className="text-right">{t('columns.pending')}</TableHead>
                                <TableHead className="text-right">{t('columns.unitCost')}</TableHead>
                                <TableHead className="w-[100px]">{t('columns.billQty')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map(item => (
                                <TableRow key={item.purchaseOrderItemId}>
                                    <TableCell>
                                        <Checkbox 
                                            checked={!!selected[item.purchaseOrderItemId]}
                                            onCheckedChange={(c) => toggleSelect(item.purchaseOrderItemId, !!c)}
                                        />
                                    </TableCell>
                                    <TableCell>{item.purchaseOrderNumber}</TableCell>
                                    <TableCell>
                                        <div className="font-medium">{item.catalogItemName}</div>
                                    </TableCell>
                                    <TableCell className="text-right">{item.quantityPending}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(item.lastUnitCost)}</TableCell>
                                    <TableCell>
                                        <Input 
                                            type="number"
                                            className="h-8 w-20 text-right"
                                            value={quantities[item.purchaseOrderItemId]}
                                            onChange={(e) => updateQuantity(item.purchaseOrderItemId, parseFloat(e.target.value), item.quantityPending)}
                                            max={item.quantityPending}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                <DialogFooter className="shrink-0 px-6 pb-6">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>{t('actions.cancel')}</Button>
                    <Button onClick={handleAdd} disabled={items.filter(i => selected[i.purchaseOrderItemId]).length === 0}>
                        {t('purchaseInvoices.unbilledModal.addSelected')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
