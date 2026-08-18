import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { generateId } from '@/lib/id'
import { useInventory } from '@/api/inventory'
import type { InventoryItem, PurchaseInvoice } from '@/api/types'
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
  const [lines, setLines] = useState<BillLine[]>(() =>
    initialData?.lines ? mapInvoiceLinesToBillLines(initialData.lines) : [],
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [stagedItem, setStagedItem] = useState<StagedBillItem | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const persistedLineIds = useMemo(
    () => new Set(initialData?.lines?.map((line) => line.id) ?? []),
    [initialData],
  )
  const selectedReceiptIds = useMemo(() => {
    const ids = new Set<string>()
    for (const line of lines) {
      if (line.receiptId) ids.add(line.receiptId)
    }
    return Array.from(ids)
  }, [lines])

  const { data: unbilledItems = [], isLoading: isUnbilledLoading } = useUnbilledReceipts(
    vendorId || undefined,
    initialData?.id,
  )
  const { data: selectedVendor } = useVendor(vendorId || '')
  const vendorBrandNames = useMemo(
    () => selectedVendor?.supportedBrands?.map((brand) => brand.name) ?? [],
    [selectedVendor?.supportedBrands],
  )
  const shouldSearchInventory = debouncedSearchQuery.length > 0 && vendorBrandNames.length > 0
  const { data: inventoryResponse } = useInventory(
    {
      search: debouncedSearchQuery || undefined,
      pageSize: 100,
    },
    { enabled: shouldSearchInventory },
  )

  const createMutation = useCreatePurchaseInvoice()
  const updateMutation = useUpdatePurchaseInvoice()
  const postMutation = usePostPurchaseInvoice()
  const deleteLineMutation = useDeletePurchaseInvoiceLine()

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
  const totals = useMemo(() => calculateBillTotals(lines), [lines])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    usePurchaseBillAutosave({
      enabled: isEdit,
      save: async (snapshot) => {
        if (!initialData) return
        await updateMutation.mutateAsync({
          id: initialData.id,
          payload: {
            vendorId: snapshot.vendorId,
            vendorInvoiceNumber: snapshot.vendorInvoiceNumber.trim(),
            invoiceDate: toLocalDateIsoString(snapshot.invoiceDate),
            dueDate: toLocalDateIsoString(snapshot.dueDate),
            items: buildInvoiceItems(snapshot.lines),
          },
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
      lines: next.lines ?? lines,
      immediate,
    })
  }

  const handleVendorChange = (nextVendorId: string) => {
    if (nextVendorId === vendorId) return
    if (lines.length > 0) {
      const proceed = window.confirm(
        'Changing vendor will clear selected receipts and bill lines. Continue?',
      )
      if (!proceed) return
    }

    setVendorId(nextVendorId)
    setLines([])
    setSearchQuery('')
    setDebouncedSearchQuery('')
    setStagedItem(null)
    setNewQty('1')
    setShowSuggestions(false)
    queueSave({ vendorId: nextVendorId, lines: [] }, true)
  }

  const toggleReceiptSelection = (receiptId: string, checked: boolean) => {
    if (checked) {
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

      setLines((previous) => {
        const existingIds = new Set(previous.map((line) => line.purchaseOrderItemId).filter(Boolean))
        const filteredNewLines = newLinesFromReceipt.filter(
          (line) => !existingIds.has(line.purchaseOrderItemId),
        )
        const nextLines = [...previous, ...filteredNewLines]
        queueSave({ lines: nextLines }, true)
        return nextLines
      })
      return
    }

    setLines((previous) => {
      const nextLines = previous.filter((line) => line.receiptId !== receiptId)
      queueSave({ lines: nextLines }, true)
      return nextLines
    })
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
  }

  const clearQuickEntry = () => {
    setSearchQuery('')
    setDebouncedSearchQuery('')
    setStagedItem(null)
    setNewQty('1')
    setShowSuggestions(false)
  }

  const confirmAddItem = () => {
    if (!stagedItem) return false
    const qty = Number(newQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Invalid quantity', { description: 'Please enter a positive number' })
      return false
    }

    setLines((previous) => {
      const existingManualLineIndex = previous.findIndex(
        (line) =>
          line.source === 'manual' &&
          !line.purchaseOrderItemId &&
          line.catalogItemId === stagedItem.id,
      )

      let next: BillLine[]
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
      queueSave({ lines: next }, true)
      return next
    })

    toast.success('Item added to bill')
    clearQuickEntry()
    return true
  }

  const updateLine = (lineId: string, updates: Partial<BillLine>, immediate = false) => {
    setLines((previous) => {
      const next = previous.map((line) =>
        line.tempId === lineId ? applyBillLineUpdates(line, updates) : line,
      )
      queueSave({ lines: next }, immediate)
      return next
    })
  }

  const removeLine = async (lineId: string) => {
    clearPendingSave()
    const isPersisted = persistedLineIds.has(lineId)

    if (isPersisted && isEdit) {
      try {
        await deleteLineMutation.mutateAsync({ id: initialData!.id, lineId })
        toast.success('Line removed')
      } catch {
        toast.error('Failed to remove line')
        return
      }
    }

    setLines((previous) => {
      const next = previous.filter((line) => line.tempId !== lineId)
      queueSave({ lines: next }, true)
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

    try {
      setIsCreating(true)
      const result = await createMutation.mutateAsync({
        vendorId,
        vendorInvoiceNumber: vendorInvoiceNumber.trim(),
        invoiceDate: toLocalDateIsoString(invoiceDate),
        dueDate: toLocalDateIsoString(dueDate),
        items: buildInvoiceItems(lines),
      })
      toast.success('Bill created')
      onSuccess(result)
    } catch (error: unknown) {
      toast.error('Failed to create bill', {
        description: getErrorMessage(error, 'Please check your input and try again'),
      })
    } finally {
      setIsCreating(false)
    }
  }

  const handlePost = async () => {
    if (!isEdit || !initialData || isPosting) return
    if (!validateForm()) return

    try {
      setIsPosting(true)
      clearPendingSave()
      abortInFlightSave()
      await updateMutation.mutateAsync({
        id: initialData.id,
        payload: {
          vendorId,
          vendorInvoiceNumber: vendorInvoiceNumber.trim(),
          invoiceDate: toLocalDateIsoString(invoiceDate),
          dueDate: toLocalDateIsoString(dueDate),
          items: buildInvoiceItems(lines),
        },
      })
      const posted = await postMutation.mutateAsync(initialData.id)
      toast.success('Bill posted successfully')
      onSuccess(posted)
    } catch (error: unknown) {
      toast.error('Failed to post bill', {
        description: getErrorMessage(error, 'Please check your input and try again'),
      })
    } finally {
      setIsPosting(false)
    }
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
    lines,
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
    isUnbilledLoading,
    filteredInventory,
    filteredReceiptSummaries,
    receiptSummaries,
    selectedReceiptIds,
    totals,
    saveStatus,
    isCreating,
    isPosting,
    isPending,
    handleVendorChange,
    toggleReceiptSelection,
    stagePart,
    confirmAddItem,
    updateLine,
    removeLine,
    handleCreateDraft,
    handlePost,
    queueSave,
  }
}
