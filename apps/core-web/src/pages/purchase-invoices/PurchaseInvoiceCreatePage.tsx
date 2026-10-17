import * as React from "react"
import { useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import { Trash2, Plus, Loader2, Package } from "lucide-react"
import { toast } from "sonner"

import { generateId } from "@/lib/id"
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
import { formatCurrency } from "@/lib/format"
import { ensureNamespaceLoaded } from "@/lib/i18n"

interface InvoiceLine {
    tempId: string
    purchaseOrderItemId?: string
    description: string
    quantity: number
    unitPrice: number
}

export default function PurchaseInvoiceCreatePage() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

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

    React.useEffect(() => {
        if (poId && unbilledItems.length > 0) {
            setIsImportModalOpen(true)
        }
    }, [poId, unbilledItems.length])

    const handleVendorChange = (newVendorId: string) => {
        if (lines.length > 0) {
            if (!confirm(t('purchaseInvoices.create.changeVendorConfirm'))) return
        }
        setVendorId(newVendorId)
        setLines([])
    }

    const handleImport = (items: { item: UnbilledReceiptItem; quantity: number }[]) => {
        setLines(prev => {
            const existingPoItemIds = new Set(
                prev
                    .filter((line) => !!line.purchaseOrderItemId)
                    .map((line) => line.purchaseOrderItemId as string)
            )

            const next = [...prev]
            let skippedDuplicates = 0

            for (const { item, quantity } of items) {
                if (existingPoItemIds.has(item.purchaseOrderItemId)) {
                    skippedDuplicates += 1
                    continue
                }

                next.push({
                    tempId: generateId(),
                    purchaseOrderItemId: item.purchaseOrderItemId,
                    description: `${item.catalogItemName} (${item.purchaseOrderNumber})`,
                    quantity: quantity,
                    unitPrice: item.lastUnitCost
                })
                existingPoItemIds.add(item.purchaseOrderItemId)
            }

            if (skippedDuplicates > 0) {
                toast.info(t('purchaseInvoices.create.toast.duplicatesSkipped', { count: skippedDuplicates }))
            }

            return next
        })
    }

    const addManualLine = () => {
        setLines(prev => [...prev, {
            tempId: generateId(),
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
        if (!vendorId) return toast.error(t('purchaseInvoices.create.toast.vendorRequired'))
        if (!vendorInvoiceNumber) return toast.error(t('purchaseInvoices.create.toast.vendorInvRequired'))
        if (lines.length === 0) return toast.error(t('purchaseInvoices.create.toast.atLeastOneLine'))

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
            toast.success(t('purchaseInvoices.create.toast.created'))
            navigate("/purchase-invoices")
        } catch {
            toast.error(t('purchaseInvoices.create.toast.createFailed'))
        }
    }

    return (
        <>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{t('purchaseInvoices.create.title')}</h1>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => navigate(-1)}>{t('actions.cancel')}</Button>
                    <Button onClick={handleSave} disabled={createInvoiceMutation.isPending}>
                        {createInvoiceMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('actions.saveAsDraft')}
                    </Button>
                </div>
            </div>

            <div className="bg-white shadow-sm border rounded-lg p-8 max-w-5xl mx-auto space-y-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="space-y-2">
                        <Label>{t('purchaseInvoices.create.vendor')}</Label>
                        <VendorCombobox value={vendorId} onChange={handleVendorChange} />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('purchaseInvoices.create.vendorInvNumber')}</Label>
                        <Input value={vendorInvoiceNumber} onChange={e => setVendorInvoiceNumber(e.target.value)} placeholder={t('purchaseInvoices.create.vendorInvPlaceholder')} />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('purchaseInvoices.create.invoiceDate')}</Label>
                        <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('purchaseInvoices.create.dueDate')}</Label>
                        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </div>
                </div>

                {vendorId && (
                    <div className="bg-slate-50 border rounded-md p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Package className="h-4 w-4" />
                            <span>{t('purchaseInvoices.create.unbilledAvailable', { count: unbilledItems.length })}</span>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={unbilledItems.length === 0}
                            onClick={() => setIsImportModalOpen(true)}
                        >
                            {t('purchaseInvoices.create.importUnbilled')}
                        </Button>
                    </div>
                )}

                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">#</TableHead>
                                <TableHead className="w-[40%]">{t('columns.description')}</TableHead>
                                <TableHead className="w-[100px]">{t('columns.qty')}</TableHead>
                                <TableHead className="w-[120px]">{t('columns.unitPrice')}</TableHead>
                                <TableHead className="text-right">{t('columns.total')}</TableHead>
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
                                            <Badge variant="outline" className="mt-1 text-xs">{t('purchaseInvoices.create.linkedToPo')}</Badge>
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
                                        {formatCurrency(line.quantity * line.unitPrice)}
                                    </TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" aria-label={t('purchaseInvoices.create.removeLineAria', { index: index + 1 })} onClick={() => removeLine(index)}>
                                            <Trash2 className="h-4 w-4 text-destructive opacity-50 hover:opacity-100" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {lines.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                        {t('purchaseInvoices.create.noLines')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-between">
                    <Button variant="outline" onClick={addManualLine}>
                        <Plus className="mr-2 h-4 w-4" /> {t('actions.addLine')}
                    </Button>
                    <div className="text-xl font-bold">
                        {t('purchaseInvoices.create.subtotal', { amount: formatCurrency(totalAmount) })}
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
        </>
    )
}
