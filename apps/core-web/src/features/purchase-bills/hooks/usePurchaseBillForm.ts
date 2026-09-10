import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { generateId } from '@/lib/id'
import { useInventory } from '@/api/inventory'
import type { CreatePurchaseInvoiceDto, InventoryItem, PurchaseInvoice } from '@/api/types'
import {
  useCreatePurchaseInvoice,
  useDeletePurchaseInvoiceLine,
  usePostPurchaseInvoice,
  useUnbilledReceipts,
  useUpdatePurchaseInvoice,
} from '@/api/usePurchaseInvoices'
import { useVendor } from '@/api/vendors'
import { getErrorMessage } from '@/lib/error-utils'
import {
  applyBillLineUpdates,
  buildInvoiceItems,
  calculateBillTotals,
  DEFAULT_TAX_RATE,
  groupReceiptSummaries,
  mapInvoiceLinesToBillLines,
  toLocalDateIsoString,
} from '../bill-utils'
import type { BillLine, StagedBillItem } from '../types'
import { usePurchaseBillAutosave } from './usePurchaseBillAutosave'

export type PurchaseBillFormProps = {
  initialData?: PurchaseInvoice
  onSuccess: (invoice: PurchaseInvoice) => void
  onCancel: () => void
}

function defaultDueDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return format(date, 'yyyy-MM-dd')
}

function formatDateField(value: string | undefined, fallback: () => string) {
  return value ? format(new Date(value), 'yyyy-MM-dd') : fallback()
}

export function validatePurchaseBillForm(
  vendorId: string,
  vendorInvoiceNumber: string,
  linesCount: number,
): { valid: boolean; error?: string } {
  if (!vendorId) {
    return { valid: false, error: 'Vendor is required' }
  }
  if (!vendorInvoiceNumber.trim()) {
    return { valid: false, error: 'Vendor invoice number is required' }
  }
  if (linesCount === 0) {
    return { valid: false, error: 'Add at least one bill line' }
  }
  return { valid: true }
}

export function addReceiptLines(
  currentLines: BillLine[],
  receiptId: string,
  unbilledItems: Array<{
    purchaseOrderId: string
    purchaseOrderNumber: string
    catalogItemId: string
    purchaseOrderItemId: string
    catalogItemName: string
    quantityPending: number
    lastUnitCost: number
  }>,
): BillLine[] {
  const newLinesFromReceipt = unbilledItems
    .filter((item) => item.purchaseOrderId === receiptId)
    .map((item) => ({
      tempId: generateId(),
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

  const existingIds = new Set(
    currentLines.map((line) => line.purchaseOrderItemId).filter(Boolean),
  )
  const filteredNewLines = newLinesFromReceipt.filter(
    (line) => !existingIds.has(line.purchaseOrderItemId),
  )
  return [...currentLines, ...filteredNewLines]
}

export function removeReceiptLines(
  currentLines: BillLine[],
  receiptId: string,
): BillLine[] {
  return currentLines.filter((line) => line.receiptId !== receiptId)
}

export function addOrMergeStagedItem(
  currentLines: BillLine[],
  stagedItem: StagedBillItem,
  qty: number,
): BillLine[] {
  const existingManualLineIndex = currentLines.findIndex(
    (line) =>
      line.source === 'manual' &&
      !line.purchaseOrderItemId &&
      line.catalogItemId === stagedItem.id,
  )

  if (existingManualLineIndex >= 0) {
    const next = [...currentLines]
    next[existingManualLineIndex] = {
      ...next[existingManualLineIndex],
      quantity: next[existingManualLineIndex].quantity + qty,
      unitCost: stagedItem.price,
    }
    return next
  }

  return [
    ...currentLines,
    {
      tempId: generateId(),
      source: 'manual',
      catalogItemId: stagedItem.id,
      description: `${stagedItem.sku} · ${stagedItem.name}`,
      quantity: qty,
      unitCost: stagedItem.price,
      taxRate: DEFAULT_TAX_RATE,
    },
  ]
}

export function buildPurchaseInvoiceMutationPayload(
  vendorId: string,
  vendorInvoiceNumber: string,
  invoiceDate: string,
  dueDate: string,
  lines: BillLine[],
) {
  return {
    vendorId,
    vendorInvoiceNumber: vendorInvoiceNumber.trim(),
    invoiceDate: toLocalDateIsoString(invoiceDate),
    dueDate: toLocalDateIsoString(dueDate),
    items: buildInvoiceItems(lines),
  }
}

export function usePurchaseBillQuickEntry() {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [stagedItem, setStagedItem] = useState<StagedBillItem | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [searchQuery])

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
  }

  const clearQuickEntry = () => {
    setSearchQuery('')
    setDebouncedSearchQuery('')
    setStagedItem(null)
    setNewQty('1')
    setShowSuggestions(false)
  }

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    setDebouncedSearchQuery,
    newQty,
    setNewQty,
    stagedItem,
    setStagedItem,
    showSuggestions,
    setShowSuggestions,
    stagePart,
    clearQuickEntry,
  }
}

export async function executeCreatePurchaseBillDraft(params: {
  vendorId: string
  vendorInvoiceNumber: string
  invoiceDate: string
  dueDate: string
  lines: BillLine[]
  createMutation: { mutateAsync: (payload: CreatePurchaseInvoiceDto) => Promise<PurchaseInvoice> }
  onSuccess: (invoice: PurchaseInvoice) => void
  setIsCreating: (val: boolean) => void
}) {
  const { valid, error } = validatePurchaseBillForm(
    params.vendorId,
    params.vendorInvoiceNumber,
    params.lines.length,
  )
  if (!valid && error) {
    toast.error(error)
    return
  }

  try {
    params.setIsCreating(true)
    const result = await params.createMutation.mutateAsync(
      buildPurchaseInvoiceMutationPayload(
        params.vendorId,
        params.vendorInvoiceNumber,
        params.invoiceDate,
        params.dueDate,
        params.lines,
      ),
    )
    toast.success('Bill created')
    params.onSuccess(result)
  } catch (error: unknown) {
    toast.error('Failed to create bill', {
      description: getErrorMessage(error, 'Please check your input and try again'),
    })
  } finally {
    params.setIsCreating(false)
  }
}

export async function executePostPurchaseBill(params: {
  initialId: string
  vendorId: string
  vendorInvoiceNumber: string
  invoiceDate: string
  dueDate: string
  lines: BillLine[]
  updateMutation: { mutateAsync: (args: { id: string; payload: CreatePurchaseInvoiceDto; signal?: AbortSignal }) => Promise<unknown> }
  postMutation: { mutateAsync: (id: string) => Promise<PurchaseInvoice> }
  clearPendingSave: () => void
  abortInFlightSave: () => void
  onSuccess: (invoice: PurchaseInvoice) => void
  setIsPosting: (val: boolean) => void
}) {
  const { valid, error } = validatePurchaseBillForm(
    params.vendorId,
    params.vendorInvoiceNumber,
    params.lines.length,
  )
  if (!valid && error) {
    toast.error(error)
    return
  }

  try {
    params.setIsPosting(true)
    params.clearPendingSave()
    params.abortInFlightSave()
    await params.updateMutation.mutateAsync({
      id: params.initialId,
      payload: buildPurchaseInvoiceMutationPayload(
        params.vendorId,
        params.vendorInvoiceNumber,
        params.invoiceDate,
        params.dueDate,
        params.lines,
      ),
    })
    const posted = await params.postMutation.mutateAsync(params.initialId)
    toast.success('Bill posted successfully')
    params.onSuccess(posted)
  } catch (error: unknown) {
    toast.error('Failed to post bill', {
      description: getErrorMessage(error, 'Please check your input and try again'),
    })
  } finally {
    params.setIsPosting(false)
  }
}

export function usePurchaseBillVendorData(
  vendorId: string,
  initialDataId: string | undefined,
  debouncedSearchQuery: string,
  receiptFilter: string,
) {
  const { data: unbilledItems = [], isLoading: isUnbilledLoading } = useUnbilledReceipts(
    vendorId || undefined,
    initialDataId,
  )
  const { data: selectedVendor } = useVendor(vendorId || '')
  const vendorBrandNames = useMemo(
    () => selectedVendor?.supportedBrands?.map((brand) => brand.name) ?? [],
    [selectedVendor?.supportedBrands],
  )
  const shouldSearchInventory =
    debouncedSearchQuery.length > 0 && vendorBrandNames.length > 0
  const { data: inventoryResponse } = useInventory(
    {
      search: debouncedSearchQuery || undefined,
      pageSize: 100,
    },
    { enabled: shouldSearchInventory },
  )

  const receiptSummaries = useMemo(
    () => groupReceiptSummaries(unbilledItems),
    [unbilledItems],
  )
  const filteredReceiptSummaries = useMemo(() => {
    const query = receiptFilter.trim().toLowerCase()
    if (!query) return receiptSummaries
    return receiptSummaries.filter((receipt) => receipt.number.toLowerCase().includes(query))
  }, [receiptFilter, receiptSummaries])

  const filteredInventory = useMemo<InventoryItem[]>(() => {
    if (!shouldSearchInventory) return []
    return (inventoryResponse?.data ?? []).filter((item) => vendorBrandNames.includes(item.brand))
  }, [inventoryResponse?.data, shouldSearchInventory, vendorBrandNames])

  return {
    unbilledItems,
    isUnbilledLoading,
    receiptSummaries,
    filteredReceiptSummaries,
    filteredInventory,
  }
}

export function usePurchaseBillLines(params: {
  initialLines?: PurchaseInvoice['lines']
  initialDataId?: string
  isEdit: boolean
  unbilledItems: Array<{
    purchaseOrderId: string
    purchaseOrderNumber: string
    catalogItemId: string
    purchaseOrderItemId: string
    catalogItemName: string
    quantityPending: number
    lastUnitCost: number
  }>
  stagedItem: StagedBillItem | null
  newQty: string
  onClearQuickEntry: () => void
  onQueueSave: (next: { lines?: BillLine[] }, immediate?: boolean) => void
  onClearPendingSave: () => void
  deleteLineMutation: ReturnType<typeof useDeletePurchaseInvoiceLine>
}) {
  const {
    initialLines,
    initialDataId,
    isEdit,
    unbilledItems,
    stagedItem,
    newQty,
    onClearQuickEntry,
    onQueueSave,
    onClearPendingSave,
    deleteLineMutation,
  } = params

  const [lines, setLines] = useState<BillLine[]>(() =>
    initialLines ? mapInvoiceLinesToBillLines(initialLines) : [],
  )

  const persistedLineIds = useMemo(
    () => new Set(initialLines?.map((line) => line.id) ?? []),
    [initialLines],
  )

  const selectedReceiptIds = useMemo(() => {
    const ids = new Set<string>()
    for (const line of lines) {
      if (line.receiptId) ids.add(line.receiptId)
    }
    return Array.from(ids)
  }, [lines])

  const toggleReceiptSelection = (receiptId: string, checked: boolean) => {
    if (checked) {
      setLines((previous) => {
        const nextLines = addReceiptLines(previous, receiptId, unbilledItems)
        onQueueSave({ lines: nextLines }, true)
        return nextLines
      })
      return
    }

    setLines((previous) => {
      const nextLines = removeReceiptLines(previous, receiptId)
      onQueueSave({ lines: nextLines }, true)
      return nextLines
    })
  }

  const confirmAddItem = () => {
    if (!stagedItem) return false
    const qty = Number(newQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Invalid quantity', { description: 'Please enter a positive number' })
      return false
    }

    setLines((previous) => {
      const next = addOrMergeStagedItem(previous, stagedItem, qty)
      onQueueSave({ lines: next }, true)
      return next
    })

    toast.success('Item added to bill')
    onClearQuickEntry()
    return true
  }

  const updateLine = (lineId: string, updates: Partial<BillLine>, immediate = false) => {
    setLines((previous) => {
      const next = previous.map((line) =>
        line.tempId === lineId ? applyBillLineUpdates(line, updates) : line,
      )
      onQueueSave({ lines: next }, immediate)
      return next
    })
  }

  const removeLine = async (lineId: string) => {
    onClearPendingSave()
    const isPersisted = persistedLineIds.has(lineId)

    if (isPersisted && isEdit && initialDataId) {
      try {
        await deleteLineMutation.mutateAsync({ id: initialDataId, lineId })
        toast.success('Line removed')
      } catch {
        toast.error('Failed to remove line')
        return
      }
    }

    setLines((previous) => {
      const next = previous.filter((line) => line.tempId !== lineId)
      onQueueSave({ lines: next }, true)
      return next
    })
  }

  return {
    lines,
    setLines,
    selectedReceiptIds,
    toggleReceiptSelection,
    confirmAddItem,
    updateLine,
    removeLine,
  }
}

export function usePurchaseBillForm({ initialData, onSuccess, onCancel }: PurchaseBillFormProps) {
  const isEdit = Boolean(initialData)

  const [vendorId, setVendorId] = useState(initialData?.vendor_id ?? '')
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState(
    initialData?.vendor_invoice_number ?? '',
  )
  const [invoiceDate, setInvoiceDate] = useState(() =>
    formatDateField(initialData?.invoice_date, () => format(new Date(), 'yyyy-MM-dd')),
  )
  const [dueDate, setDueDate] = useState(() =>
    formatDateField(initialData?.due_date, defaultDueDate),
  )
  const [receiptFilter, setReceiptFilter] = useState('')
  const [isPosting, setIsPosting] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const quickEntry = usePurchaseBillQuickEntry()
  const vendorData = usePurchaseBillVendorData(
    vendorId,
    initialData?.id,
    quickEntry.debouncedSearchQuery,
    receiptFilter,
  )

  const createMutation = useCreatePurchaseInvoice()
  const updateMutation = useUpdatePurchaseInvoice()
  const postMutation = usePostPurchaseInvoice()
  const deleteLineMutation = useDeletePurchaseInvoiceLine()

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    usePurchaseBillAutosave({
      enabled: isEdit,
      save: async (snapshot) => {
        if (!initialData) return
        await updateMutation.mutateAsync({
          id: initialData.id,
          payload: buildPurchaseInvoiceMutationPayload(
            snapshot.vendorId,
            snapshot.vendorInvoiceNumber,
            snapshot.invoiceDate,
            snapshot.dueDate,
            snapshot.lines,
          ),
          signal: snapshot.signal,
        })
      },
    })

  const queueSave = (
    next: {
      vendorId?: string
      vendorInvoiceNumber?: string
      invoiceDate?: string
      dueDate?: string
      lines?: BillLine[]
    },
    immediate = false,
  ) => {
    triggerAutoSave({
      vendorId: next.vendorId ?? vendorId,
      vendorInvoiceNumber: next.vendorInvoiceNumber ?? vendorInvoiceNumber,
      invoiceDate: next.invoiceDate ?? invoiceDate,
      dueDate: next.dueDate ?? dueDate,
      lines: next.lines ?? linesManager.lines,
      immediate,
    })
  }

  const linesManager = usePurchaseBillLines({
    initialLines: initialData?.lines,
    initialDataId: initialData?.id,
    isEdit,
    unbilledItems: vendorData.unbilledItems,
    stagedItem: quickEntry.stagedItem,
    newQty: quickEntry.newQty,
    onClearQuickEntry: quickEntry.clearQuickEntry,
    onQueueSave: queueSave,
    onClearPendingSave: clearPendingSave,
    deleteLineMutation,
  })

  const totals = useMemo(() => calculateBillTotals(linesManager.lines), [linesManager.lines])

  const handleVendorChange = (nextVendorId: string) => {
    if (nextVendorId === vendorId) return
    if (linesManager.lines.length > 0) {
      const proceed = window.confirm(
        'Changing vendor will clear selected receipts and bill lines. Continue?',
      )
      if (!proceed) return
    }

    setVendorId(nextVendorId)
    linesManager.setLines([])
    quickEntry.clearQuickEntry()
    queueSave({ vendorId: nextVendorId, lines: [] }, true)
  }

  const handleCreateDraft = () =>
    executeCreatePurchaseBillDraft({
      vendorId,
      vendorInvoiceNumber,
      invoiceDate,
      dueDate,
      lines: linesManager.lines,
      createMutation,
      onSuccess,
      setIsCreating,
    })

  const handlePost = () => {
    if (!isEdit || !initialData || isPosting) return
    return executePostPurchaseBill({
      initialId: initialData.id,
      vendorId,
      vendorInvoiceNumber,
      invoiceDate,
      dueDate,
      lines: linesManager.lines,
      updateMutation,
      postMutation,
      clearPendingSave,
      abortInFlightSave,
      onSuccess,
      setIsPosting,
    })
  }

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    postMutation.isPending ||
    deleteLineMutation.isPending ||
    isPosting ||
    isCreating

  return {
    isEdit,
    initialData,
    onCancel,
    vendorId,
    vendorInvoiceNumber,
    setVendorInvoiceNumber,
    invoiceDate,
    setInvoiceDate,
    dueDate,
    setDueDate,
    receiptFilter,
    setReceiptFilter,
    lines: linesManager.lines,
    searchQuery: quickEntry.searchQuery,
    setSearchQuery: quickEntry.setSearchQuery,
    debouncedSearchQuery: quickEntry.debouncedSearchQuery,
    setDebouncedSearchQuery: quickEntry.setDebouncedSearchQuery,
    newQty: quickEntry.newQty,
    setNewQty: quickEntry.setNewQty,
    stagedItem: quickEntry.stagedItem,
    setStagedItem: quickEntry.setStagedItem,
    showSuggestions: quickEntry.showSuggestions,
    setShowSuggestions: quickEntry.setShowSuggestions,
    isUnbilledLoading: vendorData.isUnbilledLoading,
    filteredInventory: vendorData.filteredInventory,
    filteredReceiptSummaries: vendorData.filteredReceiptSummaries,
    receiptSummaries: vendorData.receiptSummaries,
    selectedReceiptIds: linesManager.selectedReceiptIds,
    totals,
    saveStatus,
    isCreating,
    isPosting,
    isPending,
    handleVendorChange,
    toggleReceiptSelection: linesManager.toggleReceiptSelection,
    stagePart: quickEntry.stagePart,
    confirmAddItem: linesManager.confirmAddItem,
    updateLine: linesManager.updateLine,
    removeLine: linesManager.removeLine,
    handleCreateDraft,
    handlePost,
    queueSave,
  }
}
