import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useCreateDraftInvoice,
  useIssueInvoice,
  useUpdateInvoiceDiscount,
} from '@/api/invoices'
import { useInvoice } from '@/api/sales'
import type { WorkshopOrder, WorkshopTask } from '@/api/types'
import { useWorkshopCalculations, type DiscountState } from './useWorkshopCalculations'
import {
  buildWorkshopCheckoutChrome,
  createWorkshopCheckoutEventHandlers,
} from './useWorkshopCheckout.helpers'
import { getCheckoutCapabilities } from './useWorkshopCheckout.logic'

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

  const handlers = createWorkshopCheckoutEventHandlers({
    navigate,
    activeInvoiceId,
    isInvoicedWithLinkedInvoice,
    setIsCheckoutOpen,
    canCreateDraftInCheckout,
    canIssueInvoiceInCheckout,
    orderId: order?.id,
    createDraftInvoice,
    setCheckoutInvoiceIdOverride,
    fetchedInvoice,
    lineDiscountOverrides,
    checkoutLineRowByRowKey,
    checkoutLineRows,
    discountSeedFromInvoice,
    updateInvoiceDiscount,
    issueInvoice,
    setExpandedTaskGroups,
    setTaskDiscountOverrides,
    setLineDiscountOverrides,
    onReopenTask,
  })

  const { checkoutFooterTotal, footerProps } = buildWorkshopCheckoutChrome({
    isCheckoutOpen,
    activeInvoiceId,
    fetchedInvoice,
    checkoutGrossTotal,
    orderGrandTotal,
    primaryCheckoutActionLabel,
    handlers,
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
  })

  return {
    tasks,
    rawTaskTotals,
    calculations,
    activeInvoiceId,
    fetchedInvoice,
    isInvoiceLoading,
    hasLinkedInvoice,
    isInvoicedWithLinkedInvoice,
    isCheckoutOpen,
    setIsCheckoutOpen,
    closeCheckout: handlers.closeCheckout,
    expandedTaskGroups,
    taskDiscountOverrides,
    lineDiscountOverrides,
    checkoutFooterTotal,
    primaryCheckoutActionLabel,
    canCreateDraftInCheckout,
    canIssueInvoiceInCheckout,
    createDraftPending: createDraftInvoice.isPending,
    issuePending: issueInvoice.isPending,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
    orderGrandTotal,
    groupedCheckoutTasks,
    handleCheckoutAction: handlers.handleCheckoutAction,
    handleCreateDraftInCheckout: handlers.handleCreateDraftInCheckout,
    handleIssueInvoiceInCheckout: handlers.handleIssueInvoiceInCheckout,
    handleToggleGroup: handlers.handleToggleGroup,
    handleTaskDiscountValueChange: handlers.handleTaskDiscountValueChange,
    handleLineDiscountTypeChange: handlers.handleLineDiscountTypeChange,
    handleLineDiscountValueChange: handlers.handleLineDiscountValueChange,
    handleReopenTask: handlers.handleReopenTask,
    footerProps,
  }
}
