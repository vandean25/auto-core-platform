import * as React from 'react'
import { format } from 'date-fns'
import { ArrowLeft, CircleDollarSign, Loader2, Package, ReceiptText, Trash2, CloudCheck, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useInventory } from '@/api/inventory'
import type { InventoryItem, PurchaseInvoice } from '@/api/types'
import { 
    useCreatePurchaseInvoice, 
    useUpdatePurchaseInvoice, 
    useUnbilledReceipts, 
    usePostPurchaseInvoice, 
    useDeletePurchaseInvoiceLine 
} from '@/api/usePurchaseInvoices'
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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const DEFAULT_TAX_RATE = 20
const AUTO_SAVE_DEBOUNCE_MS = 750

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

interface PurchaseBillFormProps {
    initialData?: PurchaseInvoice
    onSuccess: (invoice: PurchaseInvoice) => void
    onCancel: () => void
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

export function PurchaseBillForm({ initialData, onSuccess, onCancel }: PurchaseBillFormProps) {
    const isEdit = !!initialData
    
    const [vendorId, setVendorId] = React.useState(initialData?.vendor_id ?? '')
    const [vendorInvoiceNumber, setVendorInvoiceNumber] = React.useState(initialData?.vendor_invoice_number ?? '')
    const [invoiceDate, setInvoiceDate] = React.useState(() => {
        if (initialData?.invoice_date) {
            return format(new Date(initialData.invoice_date), 'yyyy-MM-dd')
        }
        return format(new Date(), 'yyyy-MM-dd')
    })
    const [dueDate, setDueDate] = React.useState(() => {
        if (initialData?.due_date) {
            return format(new Date(initialData.due_date), 'yyyy-MM-dd')
        }
        const date = new Date()
        date.setDate(date.getDate() + 30)
        return format(date, 'yyyy-MM-dd')
    })
    
    const [receiptFilter, setReceiptFilter] = React.useState('')
    const [lines, setLines] = React.useState<BillLine[]>(() => {
        if (initialData?.lines) {
            return initialData.lines.map(line => ({
                tempId: line.id,
                source: line.purchase_order_item_id ? 'receipt' : 'manual',
                receiptId: line.purchase_order_item?.purchase_order?.id,
                receiptNumber: line.purchase_order_item?.purchase_order?.order_number,
                purchaseOrderItemId: line.purchase_order_item_id,
                description: line.description,
                quantity: parseFloat(line.quantity),
                unitCost: parseFloat(line.unit_price),
                taxRate: line.tax_rate,
            }))
        }
        return []
    })

    const persistedLineIds = React.useMemo(() => {
        return new Set(initialData?.lines?.map(l => l.id) ?? [])
    }, [initialData])

    const selectedReceiptIds = React.useMemo(() => {
        const ids = new Set<string>()
        lines.forEach(l => {
            if (l.receiptId) ids.add(l.receiptId)
        })
        return Array.from(ids)
    }, [lines])
    
    const [searchQuery, setSearchQuery] = React.useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState('')
    const [newQty, setNewQty] = React.useState('1')
    const [stagedItem, setStagedItem] = React.useState<StagedBillItem | null>(null)
    const [showSuggestions, setShowSuggestions] = React.useState(false)
    const [saveStatus, setSaveStatus] = React.useState<'saved' | 'saving' | 'error'>('saved')
    const [isPosting, setIsPosting] = React.useState(false)
    const [isCreating, setIsCreating] = React.useState(false)

    const quickEntryRef = React.useRef<HTMLDivElement | null>(null)
    const itemInputRef = React.useRef<HTMLInputElement | null>(null)
    const qtyInputRef = React.useRef<HTMLInputElement | null>(null)
    const autoSaveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const abortControllerRef = React.useRef<AbortController | null>(null)

    const { data: unbilledItems = [], isLoading: isUnbilledLoading } = useUnbilledReceipts(vendorId || undefined, initialData?.id)
    const { data: selectedVendor } = useVendor(vendorId || '')
    const vendorBrandNames = React.useMemo(
        () => selectedVendor?.supportedBrands?.map((brand) => brand.name) ?? [],
        [selectedVendor?.supportedBrands],
    )
    const { data: inventoryResponse } = useInventory({
        search: debouncedSearchQuery || undefined,
        pageSize: 100,
    })
    
    const createMutation = useCreatePurchaseInvoice()
    const updateMutation = useUpdatePurchaseInvoice()
    const postMutation = usePostPurchaseInvoice()
    const deleteLineMutation = useDeletePurchaseInvoiceLine()

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

    const filteredInventory = React.useMemo<InventoryItem[]>(() => {
        if (!debouncedSearchQuery) return []
        if (vendorBrandNames.length === 0) return []
        return (inventoryResponse?.data ?? []).filter((item) => vendorBrandNames.includes(item.brand))
    }, [debouncedSearchQuery, inventoryResponse?.data, vendorBrandNames])

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

    const performAutoSave = React.useCallback(async (
        currentVendorId: string,
        currentVendorInvoiceNumber: string,
        currentInvoiceDate: string,
        currentDueDate: string,
        currentLines: BillLine[]
    ) => {
        if (!isEdit || !initialData) return

        // Relaxed guard: allow empty lines for draft saves
        if (!currentVendorId || !currentVendorInvoiceNumber.trim()) return

        // Cancel in-flight save
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        const controller = new AbortController()
        abortControllerRef.current = controller

        setSaveStatus('saving')
        const payload = {
            vendorId: currentVendorId,
            vendorInvoiceNumber: currentVendorInvoiceNumber.trim(),
            invoiceDate: toLocalDateIsoString(currentInvoiceDate),
            dueDate: toLocalDateIsoString(currentDueDate),
            items: currentLines.map((line) => ({
                purchaseOrderItemId: line.purchaseOrderItemId,
                description: line.description.trim(),
                quantity: line.quantity,
                unitPrice: line.unitCost,
                taxRate: line.taxRate,
            })),
        }

        try {
            await updateMutation.mutateAsync({ 
                id: initialData.id, 
                payload, 
                signal: controller.signal 
            })
            if (controller.signal.aborted) return
            setSaveStatus('saved')
        } catch (error: any) {
            if (error.name === 'AbortError') return
            setSaveStatus('error')
            toast.error('Auto-save failed', { description: error.message || 'Please check your connection' })
        }
    }, [isEdit, initialData, updateMutation])

    const triggerAutoSave = React.useCallback((
        vId: string,
        vInv: string,
        iDate: string,
        dDate: string,
        ls: BillLine[],
        immediate = false
    ) => {
        if (!isEdit) return
        
        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current)
        
        if (immediate) {
            performAutoSave(vId, vInv, iDate, dDate, ls)
        } else {
            autoSaveTimeoutRef.current = setTimeout(() => {
                performAutoSave(vId, vInv, iDate, dDate, ls)
            }, AUTO_SAVE_DEBOUNCE_MS)
        }
    }, [isEdit, performAutoSave])

    const handleVendorChange = (nextVendorId: string) => {
        if (nextVendorId === vendorId) return
        if (lines.length > 0) {
            const proceed = window.confirm('Changing vendor will clear selected receipts and bill lines. Continue?')
            if (!proceed) return
        }

        setVendorId(nextVendorId)
        setLines([])
        setSearchQuery('')
        setDebouncedSearchQuery('')
        setStagedItem(null)
        setNewQty('1')
        setShowSuggestions(false)
        triggerAutoSave(nextVendorId, vendorInvoiceNumber, invoiceDate, dueDate, [], true)
    }

    const toggleReceiptSelection = (receiptId: string, checked: boolean) => {
        if (checked) {
            // Add lines from this receipt
            const newLinesFromReceipt = unbilledItems
                .filter(item => item.purchaseOrderId === receiptId)
                .map(item => ({
                    tempId: crypto.randomUUID(),
                    source: 'receipt' as const,
                    receiptId: item.purchaseOrderId,
                    receiptNumber: item.purchaseOrderNumber,
                    catalogItemId: item.catalogItemId,
                    purchaseOrderItemId: item.purchaseOrderItemId,
                    description: item.catalogItemName,
                    quantity: item.quantityPending,
                    unitCost: item.lastUnitCost,
                    taxRate: DEFAULT_TAX_RATE,
                    maxQuantity: item.quantityPending,
                }))
            
            setLines(prev => {
                const existingIds = new Set(prev.map(l => l.purchaseOrderItemId).filter(Boolean))
                const filteredNewLines = newLinesFromReceipt.filter(l => !existingIds.has(l.purchaseOrderItemId))
                const nextLines = [...prev, ...filteredNewLines]
                triggerAutoSave(vendorId, vendorInvoiceNumber, invoiceDate, dueDate, nextLines, true)
                return nextLines
            })
        } else {
            // Remove lines from this receipt
            setLines(prev => {
                const nextLines = prev.filter(l => l.receiptId !== receiptId)
                triggerAutoSave(vendorId, vendorInvoiceNumber, invoiceDate, dueDate, nextLines, true)
                return nextLines
            })
        }
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
            let next: BillLine[]
            const existingManualLineIndex = previous.findIndex(
                (line) => line.source === 'manual' && !line.purchaseOrderItemId && line.catalogItemId === stagedItem.id,
            )

            if (existingManualLineIndex >= 0) {
                next = [...previous]
                next[existingManualLineIndex] = {
                    ...next[existingManualLineIndex],
                    quantity: next[existingManualLineIndex].quantity + qty,
                    unitCost: stagedItem.price,
                }
            } else {
                next = [
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
            }
            triggerAutoSave(vendorId, vendorInvoiceNumber, invoiceDate, dueDate, next, true)
            return next
        })

        toast.success('Item added to bill')
        clearQuickEntry()
    }

    const updateLine = (lineId: string, updates: Partial<BillLine>, immediate = false) => {
        setLines((previous) => {
            const next = previous.map((line) => {
                if (line.tempId !== lineId) return line

                const nextLine = { ...line, ...updates }
                if (typeof nextLine.maxQuantity === 'number' && nextLine.quantity > nextLine.maxQuantity) {
                    nextLine.quantity = nextLine.maxQuantity
                }
                if (nextLine.quantity < 0) nextLine.quantity = 0
                if (nextLine.unitCost < 0) nextLine.unitCost = 0
                if (nextLine.taxRate < 0) nextLine.taxRate = 0
                return nextLine
            })
            triggerAutoSave(vendorId, vendorInvoiceNumber, invoiceDate, dueDate, next, immediate)
            return next
        })
    }

    const removeLine = async (lineId: string) => {
        const isPersisted = persistedLineIds.has(lineId)
        
        // Only clear timeout for unsaved lines to preserve pending edits on other lines
        if (!isPersisted && autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current)
        }

        if (isPersisted && isEdit) {
            try {
                await deleteLineMutation.mutateAsync({ id: initialData!.id, lineId })
                toast.success('Line removed')
            } catch (err) {
                toast.error('Failed to remove line')
                return
            }
        }

        setLines((previous) => {
            const next = previous.filter((line) => line.tempId !== lineId)
            // Trigger save for unsaved removals to keep backend in sync
            if (!isPersisted) {
                triggerAutoSave(vendorId, vendorInvoiceNumber, invoiceDate, dueDate, next, true)
            }
            return next
        })
    }

    const validateForm = () => {
        if (!vendorId) {
            toast.error('Vendor is required')
            return false
        }
        if (!vendorInvoiceNumber.trim()) {
            toast.error('Vendor invoice number is required')
            return false
        }
        if (lines.length === 0) {
            toast.error('Add at least one bill line')
            return false
        }
        return true
    }

    const handleCreateDraft = async () => {
        if (isCreating) return
        if (!validateForm()) return

        const payload = {
            vendorId,
            vendorInvoiceNumber: vendorInvoiceNumber.trim(),
            invoiceDate: toLocalDateIsoString(invoiceDate),
            dueDate: toLocalDateIsoString(dueDate),
            items: lines.map((line) => ({
                purchaseOrderItemId: line.purchaseOrderItemId,
                description: line.description.trim(),
                quantity: line.quantity,
                unitPrice: line.unitCost,
                taxRate: line.taxRate,
            })),
        }

        try {
            setIsCreating(true)
            const result = await createMutation.mutateAsync(payload)
            toast.success('Bill created')
            onSuccess(result)
        } catch (error: any) {
            toast.error('Failed to create bill', { description: error.message })
        } finally {
            setIsCreating(false)
        }
    }

    const handlePost = async () => {
        if (!isEdit || !initialData) return
        if (isPosting) return
        if (!validateForm()) return

        try {
            setIsPosting(true)
            if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current)
            if (abortControllerRef.current) abortControllerRef.current.abort()
            
            const payload = {
                vendorId,
                vendorInvoiceNumber: vendorInvoiceNumber.trim(),
                invoiceDate: toLocalDateIsoString(invoiceDate),
                dueDate: toLocalDateIsoString(dueDate),
                items: lines.map((line) => ({
                    purchaseOrderItemId: line.purchaseOrderItemId,
                    description: line.description.trim(),
                    quantity: line.quantity,
                    unitPrice: line.unitCost,
                    taxRate: line.taxRate,
                })),
            }
            
            await updateMutation.mutateAsync({ id: initialData.id, payload })
            const posted = await postMutation.mutateAsync(initialData.id)
            toast.success('Bill posted successfully')
            onSuccess(posted)
        } catch (err: any) {
            toast.error('Failed to post bill', { description: err.message })
        } finally {
            setIsPosting(false)
        }
    }

    const isPending = createMutation.isPending || updateMutation.isPending || postMutation.isPending || deleteLineMutation.isPending || isPosting || isCreating

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={onCancel}
                        aria-label="Back"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {isEdit ? `Edit Bill: ${initialData.vendor_invoice_number}` : 'Log New Bill'}
                        </h1>
                        <p className="text-slate-500">
                            {isEdit ? 'Modify bill details and reconcile final costs' : 'Import receipt lines and reconcile final vendor costs'}
                        </p>
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

                    <div className="flex items-center gap-4">
                        {isEdit ? (
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[140px] justify-end">
                                    {saveStatus === 'saving' && (
                                        <>
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            <span>Saving...</span>
                                        </>
                                    )}
                                    {saveStatus === 'saved' && (
                                        <>
                                            <CloudCheck className="h-3.5 w-3.5 text-green-600" />
                                            <span>All changes saved</span>
                                        </>
                                    )}
                                    {saveStatus === 'error' && (
                                        <>
                                            <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                                            <span className="text-red-600 font-medium">Save failed</span>
                                        </>
                                    )}
                                </div>

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="default" className="bg-blue-600 hover:bg-blue-700" disabled={isPending}>
                                            {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                            Post Bill
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Posting this bill will lock it for further editing. Are you sure?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handlePost} disabled={isPosting}>
                                                {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                                Post Bill
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={onCancel} disabled={isCreating}>
                                    Cancel
                                </Button>
                                <Button variant="secondary" onClick={handleCreateDraft} disabled={isCreating}>
                                    {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Loader2 className="mr-2 h-4 w-4 hidden" />}
                                    Create Draft
                                </Button>
                            </div>
                        )}
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
                            onChange={(event) => {
                                setVendorInvoiceNumber(event.target.value)
                                triggerAutoSave(vendorId, event.target.value, invoiceDate, dueDate, lines)
                            }}
                            placeholder="VND-2026-..."
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="invoiceDate">Invoice Date</Label>
                        <Input
                            id="invoiceDate"
                            type="date"
                            value={invoiceDate}
                            onChange={(event) => {
                                setInvoiceDate(event.target.value)
                                triggerAutoSave(vendorId, vendorInvoiceNumber, event.target.value, dueDate, lines, true)
                            }}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="dueDate">Due Date</Label>
                        <Input
                            id="dueDate"
                            type="date"
                            value={dueDate}
                            onChange={(event) => {
                                setDueDate(event.target.value)
                                triggerAutoSave(vendorId, vendorInvoiceNumber, invoiceDate, event.target.value, lines, true)
                            }}
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
                            </div>
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
                                        if (stagedItem) setStagedItem(null)
                                        setSearchQuery(event.target.value)
                                    }}
                                    onFocus={() => setShowSuggestions(true)}
                                    placeholder={vendorId ? 'Search part number or name...' : 'Select a vendor first'}
                                    className="h-8 text-xs"
                                    disabled={!vendorId}
                                />
                                {showSuggestions && debouncedSearchQuery && (
                                    <div className="absolute left-0 right-0 top-full z-[5] mt-1 rounded-md border bg-popover shadow-md">
                                        <Command shouldFilter={false}>
                                            <CommandList className="max-h-64">
                                                {filteredInventory.length === 0 && (
                                                    <CommandEmpty>No matching items.</CommandEmpty>
                                                )}
                                                {filteredInventory.length > 0 && (
                                                    <CommandGroup heading="Parts">
                                                        {filteredInventory.map((item) => (
                                                            <CommandItem
                                                                key={item.id}
                                                                onSelect={() => stagePart(item)}
                                                            >
                                                                <div className="flex w-full items-center justify-between gap-2">
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs font-medium">{item.sku}</div>
                                                                        <div className="truncate text-xs text-muted-foreground">{item.name}</div>
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
                                                        onChange={(event) => updateLine(line.tempId, { description: event.target.value })}
                                                    />
                                                    {line.source === 'receipt' && line.receiptNumber && (
                                                        <Badge variant="outline">Imported from {line.receiptNumber}</Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    value={line.quantity}
                                                    onChange={(event) => updateLine(line.tempId, { quantity: parseNumber(event.target.value) })}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    value={line.unitCost}
                                                    onChange={(event) => updateLine(line.tempId, { unitCost: parseNumber(event.target.value) })}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    value={line.taxRate}
                                                    onChange={(event) => updateLine(line.tempId, { taxRate: parseNumber(event.target.value) })}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right font-medium">{formatCurrency(lineTotal)}</TableCell>
                                            <TableCell>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => removeLine(line.tempId)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive opacity-60 hover:opacity-100" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>
        </div>
    )
}
