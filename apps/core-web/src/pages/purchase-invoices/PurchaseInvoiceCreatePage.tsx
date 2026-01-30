import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { format } from "date-fns"
import { Trash2, Plus, Loader2, Package } from "lucide-react"
import { toast } from "sonner"

import { useUnbilledReceipts, useCreatePurchaseInvoice } from "@/api/usePurchaseInvoices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { VendorCombobox } from "@/components/purchase-invoices/VendorCombobox"
import { UnbilledReceiptsModal } from "@/components/purchase-invoices/UnbilledReceiptsModal"
import type { UnbilledReceiptItem } from "@/api/types"

interface InvoiceLine {
    tempId: string
    purchaseOrderItemId?: string
    description: string
    quantity: number
    unitPrice: number
}

export default function PurchaseInvoiceCreatePage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const initialVendorId = searchParams.get('vendorId')

    const [vendorId, setVendorId] = React.useState<string>(initialVendorId || "")
    const poId = searchParams.get('poId')
    const [vendorInvoiceNumber, setVendorInvoiceNumber] = React.useState("")
    const [invoiceDate, setInvoiceDate] = React.useState(format(new Date(), 'yyyy-MM-dd'))
    const [dueDate, setDueDate] = React.useState(() => {
        const d = new Date()
        d.setDate(d.getDate() + 30)
        return format(d, 'yyyy-MM-dd')
    })
    
    const [lines, setLines] = React.useState<InvoiceLine[]>([])
    const [isImportModalOpen, setIsImportModalOpen] = React.useState(false)

    const { data: unbilledItems = [] } = useUnbilledReceipts(vendorId)
    const createInvoiceMutation = useCreatePurchaseInvoice()

    // Auto-open modal if poId is present
    React.useEffect(() => {
        if (poId && unbilledItems.length > 0) {
            setIsImportModalOpen(true)
        }
    }, [poId, unbilledItems.length])

    const handleVendorChange = (newVendorId: string) => {
        if (lines.length > 0) {
            if (!confirm("Changing vendor will clear existing lines. Continue?")) return
        }
        setVendorId(newVendorId)
        setLines([])
    }

    const handleImport = (items: { item: UnbilledReceiptItem; quantity: number }[]) => {
        const newLines = items.map(({ item, quantity }) => ({
            tempId: crypto.randomUUID(),
            purchaseOrderItemId: item.purchaseOrderItemId,
            description: `${item.catalogItemName} (${item.purchaseOrderNumber})`,
            quantity: quantity,
            unitPrice: item.lastUnitCost
        }))
        setLines(prev => [...prev, ...newLines])
    }

    const addManualLine = () => {
        setLines(prev => [...prev, {
            tempId: crypto.randomUUID(),
            description: "",
            quantity: 1,
            unitPrice: 0
        }])
    }

    const updateLine = (index: number, updates: Partial<InvoiceLine>) => {
        setLines(prev => {
            const copy = [...prev]
            copy[index] = { ...copy[index], ...updates }
            return copy
        })
    }

    const removeLine = (index: number) => {
        setLines(prev => prev.filter((_, i) => i !== index))
    }

    const totalAmount = lines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0)

    const handleSave = async () => {
        if (!vendorId) return toast.error("Vendor is required")
        if (!vendorInvoiceNumber) return toast.error("Vendor Invoice Number is required")
        if (lines.length === 0) return toast.error("Add at least one line")

        try {
            await createInvoiceMutation.mutateAsync({
                vendorId,
                vendorInvoiceNumber,
                invoiceDate: new Date(invoiceDate).toISOString(),
                dueDate: new Date(dueDate).toISOString(),
                items: lines.map(line => ({
                    purchaseOrderItemId: line.purchaseOrderItemId,
                    description: line.description,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice
                }))
            })
            toast.success("Purchase Invoice created")
            navigate("/purchase-invoices") // Assuming we have a list page
        } catch (error) {
            toast.error("Failed to create invoice")
        }
    }

    return (
        <div className="container mx-auto py-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold tracking-tight">Create Purchase Invoice</h1>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={createInvoiceMutation.isPending}>
                        {createInvoiceMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save as Draft
                    </Button>
                </div>
            </div>

            <div className="bg-white shadow-sm border rounded-lg p-8 max-w-5xl mx-auto space-y-8">
                {/* Header Fields */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="space-y-2">
                        <Label>Vendor</Label>
                        <VendorCombobox value={vendorId} onChange={handleVendorChange} />
                    </div>
                    <div className="space-y-2">
                        <Label>Vendor Inv #</Label>
                        <Input value={vendorInvoiceNumber} onChange={e => setVendorInvoiceNumber(e.target.value)} placeholder="VND-2026-..." />
                    </div>
                    <div className="space-y-2">
                        <Label>Invoice Date</Label>
                        <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Due Date</Label>
                        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </div>
                </div>

                {/* Import Action */}
                {vendorId && (
                    <div className="bg-slate-50 border rounded-md p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Package className="h-4 w-4" />
                            <span>{unbilledItems.length} unbilled receipts available for this vendor</span>
                        </div>
                        <Button 
                            variant="secondary" 
                            size="sm"
                            disabled={unbilledItems.length === 0}
                            onClick={() => setIsImportModalOpen(true)}
                        >
                            Import Unbilled Receipts
                        </Button>
                    </div>
                )}

                {/* Lines Table */}
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">#</TableHead>
                                <TableHead className="w-[40%]">Description</TableHead>
                                <TableHead className="w-[100px]">Qty</TableHead>
                                <TableHead className="w-[120px]">Unit Price</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {lines.map((line, index) => (
                                <TableRow key={line.tempId}>
                                    <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>
                                    <TableCell>
                                        <Input 
                                            value={line.description}
                                            onChange={e => updateLine(index, { description: e.target.value })}
                                        />
                                        {line.purchaseOrderItemId && (
                                            <Badge variant="outline" className="mt-1 text-xs">Linked to PO</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Input 
                                            type="number"
                                            value={line.quantity}
                                            onChange={e => updateLine(index, { quantity: parseFloat(e.target.value) || 0 })}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input 
                                            type="number"
                                            value={line.unitPrice}
                                            onChange={e => updateLine(index, { unitPrice: parseFloat(e.target.value) || 0 })}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        ${(line.quantity * line.unitPrice).toFixed(2)}
                                    </TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" onClick={() => removeLine(index)}>
                                            <Trash2 className="h-4 w-4 text-destructive opacity-50 hover:opacity-100" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {lines.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                        No lines added. Import receipts or add manually.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-between">
                    <Button variant="outline" onClick={addManualLine}>
                        <Plus className="mr-2 h-4 w-4" /> Add Line
                    </Button>
                    <div className="text-xl font-bold">
                        Subtotal: ${totalAmount.toFixed(2)}
                    </div>
                </div>
            </div>

            <UnbilledReceiptsModal 
                open={isImportModalOpen} 
                onOpenChange={setIsImportModalOpen}
                items={unbilledItems}
                onAdd={handleImport}
                preSelectPoId={poId}
            />
        </div>
    )
}
