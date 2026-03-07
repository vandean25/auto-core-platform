import * as React from 'react'
import { format } from 'date-fns'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CircleDollarSign, Loader2, Package, ReceiptText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useInventory } from '@/api/inventory'
import type { InventoryItem } from '@/api/types'
import { useCreatePurchaseInvoice, useUnbilledReceipts } from '@/api/usePurchaseInvoices'
import { useVendor } from '@/api/vendors'
import { VendorCombobox } from '@/components/purchase-invoices/VendorCombobox'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

const DEFAULT_TAX_RATE = 20

interface BillLine {
    tempId: string
    source: 'receipt' | 'manual'
    receiptId?: string
    receiptNumber?: string
    catalogItemId?: string
    purchaseOrderItemId?: string
    description: string
    quantity: number
    unitCost: number
    taxRate: number
    maxQuantity?: number
}

interface ReceiptSummary {
    id: string
    number: string
    lineCount: number
    pendingQuantity: number
    pendingAmount: number
}

interface StagedBillItem {
    id: string
    sku: string
    name: string
    price: number
}

function parseNumber(value: string, fallback = 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function toLocalDateIsoString(dateInput: string) {
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput)
    if (dateOnlyMatch) {
        const year = Number(dateOnlyMatch[1])
        const month = Number(dateOnlyMatch[2])
        const day = Number(dateOnlyMatch[3])
        return new Date(year, month - 1, day).toISOString()
    }

    const parsed = new Date(dateInput)
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export default function PurchaseBillCreatePage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const initialVendorId = searchParams.get('vendorId') ?? ''

    const [vendorId, setVendorId] = React.useState(initialVendorId)
    const [vendorInvoiceNumber, setVendorInvoiceNumber] = React.useState('')
    const [invoiceDate, setInvoiceDate] = React.useState(format(new Date(), 'yyyy-MM-dd'))
    const [dueDate, setDueDate] = React.useState(() => {
        const date = new Date()
        date.setDate(date.getDate() + 30)
        return format(date, 'yyyy-MM-dd')
    })
    const [receiptFilter, setReceiptFilter] = React.useState('')
    const [selectedReceiptIds, setSelectedReceiptIds] = React.useState<string[]>([])
    const [lines, setLines] = React.useState<BillLine[]>([])
    const [searchQuery, setSearchQuery] = React.useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState('')
    const [newQty, setNewQty] = React.useState('1')
    const [stagedItem, setStagedItem] = React.useState<StagedBillItem | null>(null)
    const [showSuggestions, setShowSuggestions] = React.useState(false)

    const quickEntryRef = React.useRef<HTMLDivElement | null>(null)
    const itemInputRef = React.useRef<HTMLInputElement | null>(null)
    const qtyInputRef = React.useRef<HTMLInputElement | null>(null)

    const { data: unbilledItems = [], isLoading: isUnbilledLoading } = useUnbilledReceipts(vendorId || undefined)
    const { data: selectedVendor } = useVendor(vendorId || '')
    const vendorBrandNames = React.useMemo(
        () => selectedVendor?.supportedBrands?.map((brand) => brand.name) ?? [],
        [selectedVendor?.supportedBrands],
    )
    const { data: inventoryData = [] } = useInventory({
        search: debouncedSearchQuery || undefined,
        pageSize: 100,
    })
    const createInvoiceMutation = useCreatePurchaseInvoice()

    const receiptSummaries = React.useMemo<ReceiptSummary[]>(() => {
        const grouped = new Map<string, ReceiptSummary>()

        for (const item of unbilledItems) {
            const existing = grouped.get(item.purchaseOrderId)
            const pendingAmount = item.quantityPending * item.lastUnitCost

            if (existing) {
                existing.lineCount += 1
                existing.pendingQuantity += item.quantityPending
                existing.pendingAmount += pendingAmount
            } else {
                grouped.set(item.purchaseOrderId, {
                    id: item.purchaseOrderId,
                    number: item.purchaseOrderNumber,
                    lineCount: 1,
                    pendingQuantity: item.quantityPending,
                    pendingAmount,
                })
            }
        }

        return Array.from(grouped.values()).sort((a, b) => a.number.localeCompare(b.number))
    }, [unbilledItems])

    const filteredReceiptSummaries = React.useMemo(() => {
        const query = receiptFilter.trim().toLowerCase()
        if (!query) return receiptSummaries
        return receiptSummaries.filter((receipt) =>
            receipt.number.toLowerCase().includes(query),
        )
    }, [receiptSummaries, receiptFilter])

    const filteredInventory = React.useMemo(() => {
        if (!debouncedSearchQuery) return []
        if (vendorBrandNames.length === 0) return []
        return (inventoryData ?? []).filter((item) => vendorBrandNames.includes(item.brand))
    }, [debouncedSearchQuery, inventoryData, vendorBrandNames])

    React.useEffect(() => {
        const timeout = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery.trim())
        }, 300)
        return () => window.clearTimeout(timeout)
    }, [searchQuery])

    React.useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (!quickEntryRef.current) return
            const target = event.target as Node | null
            if (target && !quickEntryRef.current.contains(target)) {
                setShowSuggestions(false)
            }
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowSuggestions(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleEscape)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [])

    React.useEffect(() => {
        if (!vendorId) {
            setSelectedReceiptIds([])
            return
        }

        setSelectedReceiptIds((previous) =>
            previous.filter((receiptId) => receiptSummaries.some((receipt) => receipt.id === receiptId)),
        )
    }, [vendorId, receiptSummaries])

    React.useEffect(() => {
        if (!vendorId) return

        const selectedSet = new Set(selectedReceiptIds)
        const selectedItems = unbilledItems.filter((item) => selectedSet.has(item.purchaseOrderId))

        setLines((previousLines) => {
            const nextLines = previousLines.filter((line) => {
                if (line.source === 'manual') return true
                return Boolean(line.receiptId && selectedSet.has(line.receiptId))
            })

            const existingReceiptLineIds = new Set(
                nextLines
                    .filter((line) => line.source === 'receipt' && line.purchaseOrderItemId)
                    .map((line) => line.purchaseOrderItemId as string),
            )

            for (const item of selectedItems) {
                if (existingReceiptLineIds.has(item.purchaseOrderItemId)) continue
                nextLines.push({
                    tempId: crypto.randomUUID(),
                    source: 'receipt',
                    receiptId: item.purchaseOrderId,
                    receiptNumber: item.purchaseOrderNumber,
                    catalogItemId: item.catalogItemId,
                    purchaseOrderItemId: item.purchaseOrderItemId,
                    description: item.catalogItemName,
                    quantity: item.quantityPending,
                    unitCost: item.lastUnitCost,
                    taxRate: DEFAULT_TAX_RATE,
                    maxQuantity: item.quantityPending,
                })
                existingReceiptLineIds.add(item.purchaseOrderItemId)
            }

            return nextLines
        })
    }, [selectedReceiptIds, unbilledItems, vendorId])

    const totals = React.useMemo(() => {
        const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0)
        const taxTotal = lines.reduce(
            (sum, line) => sum + line.quantity * line.unitCost * (line.taxRate / 100),
            0,
        )
        return {
            subtotal,
            taxTotal,
            grandTotal: subtotal + taxTotal,
        }
    }, [lines])

    const handleVendorChange = (nextVendorId: string) => {
        if (nextVendorId === vendorId) return
        if (lines.length > 0) {
            const proceed = window.confirm('Changing vendor will clear selected receipts and bill lines. Continue?')
            if (!proceed) return
        }

        setVendorId(nextVendorId)
        setSelectedReceiptIds([])
        setLines([])
        setSearchQuery('')
        setDebouncedSearchQuery('')
        setStagedItem(null)
        setNewQty('1')
        setShowSuggestions(false)
    }

    const toggleReceiptSelection = (receiptId: string, checked: boolean) => {
        setSelectedReceiptIds((previous) => {
            if (checked) {
                if (previous.includes(receiptId)) return previous
                return [...previous, receiptId]
            }
            return previous.filter((id) => id !== receiptId)
        })
    }

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const firstResult = filteredInventory[0]
        if (firstResult) {
            stagePart(firstResult)
        }
    }

    const handleQtyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        confirmAddItem()
    }

    const stagePart = (item: InventoryItem) => {
        setStagedItem({
            id: item.id,
            sku: item.sku,
            name: item.name,
            price: Number(item.price),
        })
        setSearchQuery(`${item.sku} · ${item.name}`)
        setDebouncedSearchQuery('')
        setNewQty('1')
        setShowSuggestions(false)
        requestAnimationFrame(() => {
            qtyInputRef.current?.focus()
            qtyInputRef.current?.select()
        })
    }

    const clearQuickEntry = () => {
        setSearchQuery('')
        setDebouncedSearchQuery('')
        setStagedItem(null)
        setNewQty('1')
        setShowSuggestions(false)
        requestAnimationFrame(() => {
            itemInputRef.current?.focus()
        })
    }

    const confirmAddItem = () => {
        if (!stagedItem) return
        const qty = Number(newQty)

        if (!Number.isFinite(qty) || qty <= 0) {
            toast.error('Invalid quantity', { description: 'Please enter a positive number' })
            return
        }

        setLines((previous) => {
            const existingManualLineIndex = previous.findIndex(
                (line) => line.source === 'manual' && !line.purchaseOrderItemId && line.catalogItemId === stagedItem.id,
            )

            if (existingManualLineIndex >= 0) {
                const next = [...previous]
                next[existingManualLineIndex] = {
                    ...next[existingManualLineIndex],
                    quantity: next[existingManualLineIndex].quantity + qty,
                    unitCost: stagedItem.price,
                }
                return next
            }

            return [
                ...previous,
                {
                    tempId: crypto.randomUUID(),
                    source: 'manual',
                    catalogItemId: stagedItem.id,
                    description: `${stagedItem.sku} · ${stagedItem.name}`,
                    quantity: qty,
                    unitCost: stagedItem.price,
                    taxRate: DEFAULT_TAX_RATE,
                },
            ]
        })

        toast.success('Item added to bill')
        clearQuickEntry()
    }

    const updateLine = (lineId: string, updates: Partial<BillLine>) => {
        setLines((previous) =>
            previous.map((line) => {
                if (line.tempId !== lineId) return line

                const nextLine = { ...line, ...updates }
                if (typeof nextLine.maxQuantity === 'number' && nextLine.quantity > nextLine.maxQuantity) {
                    nextLine.quantity = nextLine.maxQuantity
                }
                if (nextLine.quantity < 0) nextLine.quantity = 0
                if (nextLine.unitCost < 0) nextLine.unitCost = 0
                if (nextLine.taxRate < 0) nextLine.taxRate = 0
                return nextLine
            }),
        )
    }

    const removeLine = (lineId: string) => {
        setLines((previous) => previous.filter((line) => line.tempId !== lineId))
    }

    const handleCreateBill = async () => {
        if (!vendorId) {
            toast.error('Vendor is required')
            return
        }

        if (!vendorInvoiceNumber.trim()) {
            toast.error('Vendor invoice number is required')
            return
        }

        if (lines.length === 0) {
            toast.error('Add at least one bill line')
            return
        }

        const hasInvalidLine = lines.some(
            (line) => !line.description.trim() || line.quantity <= 0 || !Number.isFinite(line.unitCost),
        )
        if (hasInvalidLine) {
            toast.error('Each line needs description, positive quantity, and a valid unit cost')
            return
        }

        try {
            const createdInvoice = await createInvoiceMutation.mutateAsync({
                vendorId,
                vendorInvoiceNumber: vendorInvoiceNumber.trim(),
                invoiceDate: toLocalDateIsoString(invoiceDate),
                dueDate: toLocalDateIsoString(dueDate),
                items: lines.map((line) => ({
                    purchaseOrderItemId: line.purchaseOrderItemId,
                    description: line.description.trim(),
                    quantity: line.quantity,
                    unitPrice: line.unitCost,
                })),
            })

            toast.success('Bill created')
            navigate(`/purchase-bills/${createdInvoice.id}`)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create bill')
        }
    }

    return (
        <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
            <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => navigate('/purchase-bills')}
                        aria-label="Back to bills"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Log New Bill</h1>
                        <p className="text-slate-500">Import receipt lines and reconcile final vendor costs</p>
                    </div>
                </div>

                <div className="flex w-full flex-col gap-3 xl:w-auto xl:items-end">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:min-w-[430px]">
                        <div className="rounded-xl border bg-muted/40 px-3 py-2">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Package className="h-3.5 w-3.5" />
                                <span>Items</span>
                            </div>
                            <div className="mt-1 text-sm font-medium">{formatCurrency(totals.subtotal)}</div>
                        </div>
                        <div className="rounded-xl border bg-muted/40 px-3 py-2">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <ReceiptText className="h-3.5 w-3.5" />
                                <span>Tax</span>
                            </div>
                            <div className="mt-1 text-sm font-medium">{formatCurrency(totals.taxTotal)}</div>
                        </div>
                        <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
                            <div className="flex items-center gap-1.5 text-[11px] text-primary/80">
                                <CircleDollarSign className="h-3.5 w-3.5" />
                                <span>Total</span>
                            </div>
                            <div className="mt-1 text-sm font-semibold text-primary">{formatCurrency(totals.grandTotal)}</div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => navigate('/purchase-bills')}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateBill} disabled={createInvoiceMutation.isPending}>
                            {createInvoiceMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create Bill
                        </Button>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-lg border p-6 space-y-6">
                <div className="space-y-2 max-w-md">
                    <Label htmlFor="vendor-combobox">Vendor</Label>
                    <div id="vendor-combobox">
                        <VendorCombobox value={vendorId} onChange={handleVendorChange} />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="vendorInvoiceNumber">Vendor Bill #</Label>
                        <Input
                            id="vendorInvoiceNumber"
                            value={vendorInvoiceNumber}
                            onChange={(event) => setVendorInvoiceNumber(event.target.value)}
                            placeholder="VND-2026-..."
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="invoiceDate">Invoice Date</Label>
                        <Input
                            id="invoiceDate"
                            type="date"
                            value={invoiceDate}
                            onChange={(event) => setInvoiceDate(event.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="dueDate">Due Date</Label>
                        <Input
                            id="dueDate"
                            type="date"
                            value={dueDate}
                            onChange={(event) => setDueDate(event.target.value)}
                        />
                    </div>
                </div>

                {vendorId && (
                    <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <ReceiptText className="h-4 w-4" />
                            {receiptSummaries.length > 0
                                ? `${receiptSummaries.length} Unbilled Receipts Found`
                                : 'No Unbilled Receipts Found'}
                        </div>

                        {isUnbilledLoading && (
                            <p className="text-sm text-slate-500">Checking unbilled receipts...</p>
                        )}

                        {!isUnbilledLoading && receiptSummaries.length > 0 && (
                            <div className="space-y-2">
                                <Input
                                    value={receiptFilter}
                                    onChange={(event) => setReceiptFilter(event.target.value)}
                                    placeholder="Filter by receipt #"
                                    aria-label="Filter unbilled receipts by receipt number"
                                />

                                {filteredReceiptSummaries.map((receipt) => {
                                    const isChecked = selectedReceiptIds.includes(receipt.id)
                                    return (
                                        <label
                                            key={receipt.id}
                                            className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Checkbox
                                                    checked={isChecked}
                                                    onCheckedChange={(checked) =>
                                                        toggleReceiptSelection(receipt.id, Boolean(checked))
                                                    }
                                                    aria-label={`Select receipt ${receipt.number}`}
                                                />
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{receipt.number}</span>
                                                    <span className="text-xs text-slate-500">
                                                        {receipt.lineCount} line(s), {receipt.pendingQuantity} qty pending
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="text-sm font-medium">{formatCurrency(receipt.pendingAmount)}</div>
                                        </label>
                                    )
                                })}
                                {filteredReceiptSummaries.length === 0 && (
                                    <p className="text-sm text-slate-500 px-1">
                                        No receipts match this number.
                                    </p>
                                )}
                            </div>
                        )}

                        {!isUnbilledLoading && receiptSummaries.length === 0 && (
                            <p className="text-sm text-slate-500">
                                You can still create this bill manually using the line editor below.
                            </p>
                        )}
                    </div>
                )}

                <div className="space-y-3">
                    <div ref={quickEntryRef} className="border rounded-xl bg-muted/40 px-3 py-2">
                        <div className="grid grid-cols-[1fr_70px_auto] gap-2">
                            <div className="relative">
                                <Input
                                    ref={itemInputRef}
                                    value={searchQuery}
                                    onChange={(event) => {
                                        if (stagedItem) {
                                            setStagedItem(null)
                                        }
                                        setSearchQuery(event.target.value)
                                    }}
                                    onFocus={() => setShowSuggestions(true)}
                                    onKeyDown={handleSearchKeyDown}
                                    placeholder={vendorId ? 'Search part number or name...' : 'Select a vendor first'}
                                    className="h-8 text-xs"
                                    disabled={!vendorId}
                                />
                                {showSuggestions && debouncedSearchQuery && (
                                    <div className="absolute left-0 right-0 top-full z-[5] mt-1 rounded-md border bg-popover shadow-md">
                                        <Command shouldFilter={false}>
                                            <CommandList className="max-h-64">
                                                {filteredInventory.length === 0 && (
                                                    <CommandEmpty>
                                                        {vendorBrandNames.length === 0
                                                            ? 'No vendor supported brands configured.'
                                                            : 'No matching items in supported brands.'}
                                                    </CommandEmpty>
                                                )}
                                                {filteredInventory.length > 0 && (
                                                    <CommandGroup heading="Parts">
                                                        {filteredInventory.map((item) => (
                                                            <CommandItem
                                                                key={item.id}
                                                                value={`${item.sku} ${item.name}`}
                                                                onSelect={() => stagePart(item)}
                                                            >
                                                                <div className="flex w-full items-center justify-between gap-2">
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs font-medium">{item.sku}</div>
                                                                        <div className="truncate text-xs text-muted-foreground">
                                                                            {item.name}
                                                                        </div>
                                                                    </div>
                                                                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                                                                        <div>{formatCurrency(item.price)}</div>
                                                                        <div>Stock: {item.quantity_available}</div>
                                                                    </div>
                                                                </div>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                )}
                                            </CommandList>
                                        </Command>
                                    </div>
                                )}
                            </div>

                            <Input
                                ref={qtyInputRef}
                                value={newQty}
                                onChange={(event) => setNewQty(event.target.value)}
                                onKeyDown={handleQtyKeyDown}
                                placeholder="Qty"
                                className="h-8 text-xs text-right"
                                disabled={!stagedItem}
                            />

                            <Button
                                type="button"
                                size="sm"
                                className="h-8 px-3 text-xs"
                                onClick={confirmAddItem}
                                disabled={!stagedItem}
                            >
                                + Add
                            </Button>
                        </div>
                    </div>

                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[48px]">#</TableHead>
                                    <TableHead className="w-[38%]">Description</TableHead>
                                    <TableHead className="w-[90px]">Qty</TableHead>
                                    <TableHead className="w-[110px]">Unit Cost</TableHead>
                                    <TableHead className="w-[90px]">Tax (%)</TableHead>
                                    <TableHead className="text-right">Line Net</TableHead>
                                    <TableHead className="text-right">Tax</TableHead>
                                    <TableHead className="text-right">Line Total</TableHead>
                                    <TableHead className="w-[48px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lines.map((line, index) => {
                                    const lineNet = line.quantity * line.unitCost
                                    const lineTax = lineNet * (line.taxRate / 100)
                                    const lineTotal = lineNet + lineTax
                                    return (
                                        <TableRow key={line.tempId}>
                                            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell>
                                                <div className="space-y-1">
                                                    <Input
                                                        value={line.description}
                                                        onChange={(event) =>
                                                            updateLine(line.tempId, { description: event.target.value })
                                                        }
                                                        placeholder="Line description"
                                                    />
                                                    {line.source === 'receipt' && line.receiptId && (
                                                        <Badge variant="outline">
                                                            Imported from {line.receiptNumber ?? line.receiptId}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={line.quantity}
                                                    onChange={(event) =>
                                                        updateLine(line.tempId, {
                                                            quantity: parseNumber(event.target.value, 0),
                                                        })
                                                    }
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={line.unitCost}
                                                    onChange={(event) =>
                                                        updateLine(line.tempId, {
                                                            unitCost: parseNumber(event.target.value, 0),
                                                        })
                                                    }
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={line.taxRate}
                                                    onChange={(event) =>
                                                        updateLine(line.tempId, {
                                                            taxRate: parseNumber(event.target.value, 0),
                                                        })
                                                    }
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">{formatCurrency(lineNet)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(lineTax)}</TableCell>
                                            <TableCell className="text-right font-medium">
                                                {formatCurrency(lineTotal)}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => removeLine(line.tempId)}
                                                    aria-label={`Remove line ${index + 1}`}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive opacity-60 hover:opacity-100" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}

                                {lines.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={9} className="h-20 text-center text-slate-500">
                                            Select unbilled receipts or add a manual line to start this bill.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                </div>
            </div>
        </div>
    )
}
