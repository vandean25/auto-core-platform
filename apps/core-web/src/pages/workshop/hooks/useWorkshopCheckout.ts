import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  useCreateDraftInvoice,
  useIssueInvoice,
  useUpdateInvoiceDiscount,
} from '@/api/invoices'
import { useInvoice } from '@/api/sales'
import { parseDiscountValue } from '@/lib/discount'
import type {
  DiscountType,
  Invoice,
  WorkshopOrder,
  WorkshopTask,
  WorkshopTaskLineItem,
} from '@/api/types'
import {
  useWorkshopCalculations,
  findInvoiceItemByLineItemId,
  EMPTY_DISCOUNT_STATE,
} from './useWorkshopCalculations'
import type { DiscountState } from './useWorkshopCalculations'
import type { CheckoutFooterProps } from '../components/CheckoutFooter'
import { getErrorMessage } from '../utils/error'

export interface CheckoutLineRow {
  rowKey: string
  taskId: string
  lineItem: WorkshopTaskLineItem
}

export interface InvoiceLineDiscountUpdate {
  id: string
  discountType: DiscountType | null
  discountValue: number | null
}

export function buildInvoiceLineDiscountUpdates(
  lineDiscountOverrides: Record<string, DiscountState>,
  checkoutLineRowByRowKey: Map<string, { lineItem: { id: string } }>,
  invoiceItems: Invoice['items'],
): InvoiceLineDiscountUpdate[] {
  const lineItemUpdatesById: Record<string, InvoiceLineDiscountUpdate> = {}

  for (const [rowKey, discount] of Object.entries(lineDiscountOverrides)) {
    const lineRow = checkoutLineRowByRowKey.get(rowKey)
    if (!lineRow) continue

    const invoiceItem = findInvoiceItemByLineItemId(
      invoiceItems,
      lineRow.lineItem.id,
    )
    if (!invoiceItem) continue

    const discountValue = discount.type
      ? parseDiscountValue(discount.value)
      : null
    lineItemUpdatesById[invoiceItem.id] = {
      id: invoiceItem.id,
      discountType: discount.type,
      discountValue,
    }
  }

  return Object.values(lineItemUpdatesById)
}

export function buildCheckoutFooterProps(
  props: CheckoutFooterProps,
): CheckoutFooterProps {
  return props
}

export function getCheckoutCapabilities(params: {
  orderStatus?: string
  activeInvoiceId: string | null
  invoiceStatus: string | null
  isLocked: boolean
  isCreateDraftPending: boolean
  isIssuePending: boolean
  isUpdateDiscountPending: boolean
}) {
  const canCreateDraftInCheckout =
    !params.activeInvoiceId &&
    params.orderStatus === 'COMPLETED' &&
    !params.isCreateDraftPending
  const canIssueInvoiceInCheckout =
    !!params.activeInvoiceId &&
    params.invoiceStatus === 'DRAFT' &&
    !params.isLocked &&
    !params.isIssuePending &&
    !params.isUpdateDiscountPending
  const isInvoicedWithLinkedInvoice =
    params.orderStatus === 'INVOICED' && !!params.activeInvoiceId
  const primaryCheckoutActionLabel = isInvoicedWithLinkedInvoice
    ? 'Open Invoice'
    : 'Checkout'

  return {
    canCreateDraftInCheckout,
    canIssueInvoiceInCheckout,
    isInvoicedWithLinkedInvoice,
    primaryCheckoutActionLabel,
  }
}

export function computeTaskLineDiscountOverrides(
  taskId: string,
  value: string,
  checkoutLineRows: Array<{ taskId: string; rowKey: string }>,
  currentOverrides: Record<string, DiscountState>,
): Record<string, DiscountState> {
  const taskLineKeys = checkoutLineRows
    .filter((lineRow) => lineRow.taskId === taskId)
    .map((lineRow) => lineRow.rowKey)

  const next = { ...currentOverrides }
  taskLineKeys.forEach((rowKey) => {
    next[rowKey] = value.trim()
      ? { type: 'PERCENTAGE', value }
      : { type: null, value: '' }
  })
  return next
}

export function computeUpdatedLineDiscountType(
  rowKey: string,
  value: string,
  currentOverrides: Record<string, DiscountState>,
  seed: Record<string, DiscountState>,
): Record<string, DiscountState> {
  const nextType = value === 'NONE' ? null : (value as DiscountType)
  const current =
    currentOverrides[rowKey] ?? seed[rowKey] ?? EMPTY_DISCOUNT_STATE
  return {
    ...currentOverrides,
    [rowKey]: {
      ...current,
      type: nextType,
      value: nextType ? current.value : '',
    },
  }
}

export function computeUpdatedLineDiscountValue(
  rowKey: string,
  value: string,
  currentOverrides: Record<string, DiscountState>,
  seed: Record<string, DiscountState>,
): Record<string, DiscountState> {
  const current =
    currentOverrides[rowKey] ?? seed[rowKey] ?? EMPTY_DISCOUNT_STATE
  return {
    ...currentOverrides,
    [rowKey]: {
      ...current,
      value,
    },
  }
}

export async function executeCreateDraftInvoice(
  orderId: string,
  createDraftInvoice: { mutateAsync: (id: string) => Promise<Invoice> },
): Promise<string | null> {
  try {
    const invoice = await createDraftInvoice.mutateAsync(orderId)
    toast.success(`Draft invoice created (${invoice.invoice_number || invoice.id})`)
    return invoice.id
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, 'Failed to create draft invoice'))
    return null
  }
}

export async function executeIssueInvoiceWithDiscounts(params: {
  activeInvoiceId: string
  fetchedInvoice: Invoice | null | undefined
  lineDiscountOverrides: Record<string, DiscountState>
  checkoutLineRowByRowKey: Map<string, { lineItem: { id: string } }>
  updateInvoiceDiscount: {
    mutateAsync: (args: {
      invoiceId: string
      payload: { lineItems: InvoiceLineDiscountUpdate[] }
    }) => Promise<unknown>
  }
  issueInvoice: { mutateAsync: (id: string) => Promise<Invoice> }
}): Promise<void> {
  const {
    activeInvoiceId,
    fetchedInvoice,
    lineDiscountOverrides,
    checkoutLineRowByRowKey,
    updateInvoiceDiscount,
    issueInvoice,
  } = params

  try {
    if (fetchedInvoice && Object.keys(lineDiscountOverrides).length > 0) {
      const lineItems = buildInvoiceLineDiscountUpdates(
        lineDiscountOverrides,
        checkoutLineRowByRowKey,
        fetchedInvoice.items,
      )
      if (lineItems.length > 0) {
        await updateInvoiceDiscount.mutateAsync({
          invoiceId: activeInvoiceId,
          payload: { lineItems },
        })
      }
    }

    const invoice = await issueInvoice.mutateAsync(activeInvoiceId)
    toast.success(`Invoice issued (${invoice.invoice_number || invoice.id})`)
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, 'Failed to issue invoice'))
  }
}

export interface UseWorkshopCheckoutOptions {
  order: WorkshopOrder | undefined
  taskLineItemOverrides?: Record<string, WorkshopTask['lineItems']>
  onReopenTask?: (taskId: string) => void
}

export function useWorkshopCheckout({
  order,
  taskLineItemOverrides = {},
  onReopenTask,
}: UseWorkshopCheckoutOptions) {
  const navigate = useNavigate()
  const createDraftInvoice = useCreateDraftInvoice()
  const issueInvoice = useIssueInvoice()
  const updateInvoiceDiscount = useUpdateInvoiceDiscount()

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<
    Record<string, boolean>
  >({})
  const [taskDiscountOverrides, setTaskDiscountOverrides] = useState<
    Record<string, string>
  >({})
  const [lineDiscountOverrides, setLineDiscountOverrides] = useState<
    Record<string, DiscountState>
  >({})
  const [checkoutInvoiceIdOverride, setCheckoutInvoiceIdOverride] = useState<
    string | null
  >(null)

  const activeInvoiceId = order?.invoice?.id ?? checkoutInvoiceIdOverride
  const { data: fetchedInvoice, isLoading: isInvoiceLoading } = useInvoice(
    activeInvoiceId ?? '',
  )

  const calculations = useWorkshopCalculations({
    orderTasks: order?.tasks,
    taskLineItemOverrides,
    lineDiscountOverrides,
    fetchedInvoice: fetchedInvoice ?? null,
    isCheckoutView: isCheckoutOpen,
  })

  const {
    tasks,
    rawTaskTotals,
    checkoutLineRows,
    checkoutLineRowByRowKey,
    groupedCheckoutTasks,
    discountSeedFromInvoice,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
    orderGrandTotal,
  } = calculations

  const isLocked = order?.status === 'INVOICED'
  const hasLinkedInvoice = !!activeInvoiceId
  const invoiceStatus = fetchedInvoice?.status ?? null

  const {
    canCreateDraftInCheckout,
    canIssueInvoiceInCheckout,
    isInvoicedWithLinkedInvoice,
    primaryCheckoutActionLabel,
  } = getCheckoutCapabilities({
    orderStatus: order?.status,
    activeInvoiceId,
    invoiceStatus,
    isLocked,
    isCreateDraftPending: createDraftInvoice.isPending,
    isIssuePending: issueInvoice.isPending,
    isUpdateDiscountPending: updateInvoiceDiscount.isPending,
  })

  const handleCheckoutAction = () => {
    if (isInvoicedWithLinkedInvoice) {
      navigate(`/sales/invoices/${activeInvoiceId}`)
      return
    }
    setIsCheckoutOpen((previous) => !previous)
  }

  const handleCreateDraftInCheckout = async () => {
    if (!canCreateDraftInCheckout || !order) return
    const id = await executeCreateDraftInvoice(order.id, createDraftInvoice)
    if (id) setCheckoutInvoiceIdOverride(id)
  }

  const handleIssueInvoiceInCheckout = async () => {
    if (!activeInvoiceId || !canIssueInvoiceInCheckout) return
    await executeIssueInvoiceWithDiscounts({
      activeInvoiceId,
      fetchedInvoice,
      lineDiscountOverrides,
      checkoutLineRowByRowKey,
      updateInvoiceDiscount,
      issueInvoice,
    })
  }

  const handleToggleGroup = (taskId: string) => {
    setExpandedTaskGroups((previous) => ({
      ...previous,
      [taskId]: !previous[taskId],
    }))
  }

  const handleTaskDiscountValueChange = (taskId: string, value: string) => {
    setTaskDiscountOverrides((previous) => ({
      ...previous,
      [taskId]: value,
    }))

    setLineDiscountOverrides((previous) =>
      computeTaskLineDiscountOverrides(
        taskId,
        value,
        checkoutLineRows,
        previous,
      ),
    )
  }

  const handleLineDiscountTypeChange = (rowKey: string, value: string) => {
    setLineDiscountOverrides((previous) =>
      computeUpdatedLineDiscountType(
        rowKey,
        value,
        previous,
        discountSeedFromInvoice,
      ),
    )
  }

  const handleLineDiscountValueChange = (rowKey: string, value: string) => {
    setLineDiscountOverrides((previous) =>
      computeUpdatedLineDiscountValue(
        rowKey,
        value,
        previous,
        discountSeedFromInvoice,
      ),
    )
  }

  const handleReopenTask = (taskId: string) => {
    setIsCheckoutOpen(false)
    onReopenTask?.(taskId)
  }

  const closeCheckout = () => setIsCheckoutOpen(false)

  const checkoutFooterTotal =
    activeInvoiceId && fetchedInvoice ? checkoutGrossTotal : orderGrandTotal

  const footerProps = buildCheckoutFooterProps({
    checkoutFooterTotal,
    isCheckoutOpen,
    primaryActionLabel: primaryCheckoutActionLabel,
    onPrimaryAction: handleCheckoutAction,
    onClose: closeCheckout,
    activeInvoiceId,
    fetchedInvoice,
    isInvoiceLoading,
    isLocked,
    canCreateDraftInCheckout,
    canIssueInvoiceInCheckout,
    createDraftPending: createDraftInvoice.isPending,
    issuePending: issueInvoice.isPending,
    groupedCheckoutTasks,
    expandedTaskGroups,
    taskDiscountOverrides,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
    onToggleGroup: handleToggleGroup,
    onTaskDiscountValueChange: handleTaskDiscountValueChange,
    onLineDiscountTypeChange: handleLineDiscountTypeChange,
    onLineDiscountValueChange: handleLineDiscountValueChange,
    onCreateDraftInvoice: () => void handleCreateDraftInCheckout(),
    onIssueInvoice: () => void handleIssueInvoiceInCheckout(),
    onReopenTask: handleReopenTask,
  })

  return {
    // Tasks and calculation outputs
    tasks,
    rawTaskTotals,
    calculations,

    // Invoice state
    activeInvoiceId,
    fetchedInvoice,
    isInvoiceLoading,
    hasLinkedInvoice,
    isInvoicedWithLinkedInvoice,

    // Checkout UI state
    isCheckoutOpen,
    setIsCheckoutOpen,
    closeCheckout,
    expandedTaskGroups,
    taskDiscountOverrides,
    lineDiscountOverrides,

    // Totals and permissions
    checkoutFooterTotal,
    primaryCheckoutActionLabel,
    canCreateDraftInCheckout,
    canIssueInvoiceInCheckout,
    createDraftPending: createDraftInvoice.isPending,
    issuePending: issueInvoice.isPending,

    // Calculation details
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
    orderGrandTotal,
    groupedCheckoutTasks,

    // Handlers
    handleCheckoutAction,
    handleCreateDraftInCheckout,
    handleIssueInvoiceInCheckout,
    handleToggleGroup,
    handleTaskDiscountValueChange,
    handleLineDiscountTypeChange,
    handleLineDiscountValueChange,
    handleReopenTask,

    // Pre-bound props bundle for CheckoutFooter
    footerProps,
  }
}
