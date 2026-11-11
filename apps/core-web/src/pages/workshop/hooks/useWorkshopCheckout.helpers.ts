import type { NavigateFunction } from 'react-router-dom'
import type { Invoice } from '@/api/types'
import type { GroupedCheckoutTask } from './useWorkshopCalculations'
import type { DiscountState } from './useWorkshopCalculations'
import { resolveCheckoutFooterTotal } from '@/lib/workshop-checkout-billing'
import type { CheckoutFooterProps } from '../components/CheckoutFooter'
import { buildCheckoutFooterProps } from './useWorkshopCheckout.logic'
import {
  computeTaskLineDiscountOverrides,
  computeUpdatedLineDiscountType,
  computeUpdatedLineDiscountValue,
  executeCreateDraftInvoice,
  executeIssueInvoiceWithDiscounts,
} from './useWorkshopCheckout.logic'

export function createWorkshopCheckoutEventHandlers(params: {
  navigate: NavigateFunction
  activeInvoiceId: string | null | undefined
  isInvoicedWithLinkedInvoice: boolean
  setIsCheckoutOpen: React.Dispatch<React.SetStateAction<boolean>>
  canCreateDraftInCheckout: boolean
  canIssueInvoiceInCheckout: boolean
  orderId: string | undefined
  createDraftInvoice: { mutateAsync: (orderId: string) => Promise<Invoice> }
  setCheckoutInvoiceIdOverride: React.Dispatch<React.SetStateAction<string | null>>
  fetchedInvoice: Invoice | null | undefined
  lineDiscountOverrides: Record<string, DiscountState>
  checkoutLineRowByRowKey: Map<string, { lineItem: { id: string } }>
  checkoutLineRows: Array<{ taskId: string; rowKey: string }>
  discountSeedFromInvoice: Record<string, DiscountState>
  updateInvoiceDiscount: {
    mutateAsync: (args: {
      invoiceId: string
      payload: {
        lineItems: import('./useWorkshopCheckout.logic').InvoiceLineDiscountUpdate[]
      }
    }) => Promise<unknown>
  }
  issueInvoice: { mutateAsync: (id: string) => Promise<Invoice> }
  setExpandedTaskGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setTaskDiscountOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setLineDiscountOverrides: React.Dispatch<React.SetStateAction<Record<string, DiscountState>>>
  onReopenTask?: (taskId: string) => void
}) {
  const handleCheckoutAction = () => {
    if (params.isInvoicedWithLinkedInvoice && params.activeInvoiceId) {
      params.navigate(`/sales/invoices/${params.activeInvoiceId}`)
      return
    }
    params.setIsCheckoutOpen((previous) => !previous)
  }

  const handleCreateDraftInCheckout = async () => {
    if (!params.canCreateDraftInCheckout || !params.orderId) return
    const id = await executeCreateDraftInvoice(params.orderId, params.createDraftInvoice)
    if (id) params.setCheckoutInvoiceIdOverride(id)
  }

  const handleIssueInvoiceInCheckout = async () => {
    if (!params.activeInvoiceId || !params.canIssueInvoiceInCheckout) return
    await executeIssueInvoiceWithDiscounts({
      activeInvoiceId: params.activeInvoiceId,
      fetchedInvoice: params.fetchedInvoice,
      lineDiscountOverrides: params.lineDiscountOverrides,
      checkoutLineRowByRowKey: params.checkoutLineRowByRowKey,
      updateInvoiceDiscount: params.updateInvoiceDiscount,
      issueInvoice: params.issueInvoice,
    })
  }

  const handleToggleGroup = (taskId: string) => {
    params.setExpandedTaskGroups((previous) => ({
      ...previous,
      [taskId]: !previous[taskId],
    }))
  }

  const handleTaskDiscountValueChange = (taskId: string, value: string) => {
    params.setTaskDiscountOverrides((previous) => ({
      ...previous,
      [taskId]: value,
    }))
    params.setLineDiscountOverrides((previous) =>
      computeTaskLineDiscountOverrides(
        taskId,
        value,
        params.checkoutLineRows,
        previous,
      ),
    )
  }

  const handleLineDiscountTypeChange = (rowKey: string, value: string) => {
    params.setLineDiscountOverrides((previous) =>
      computeUpdatedLineDiscountType(
        rowKey,
        value,
        previous,
        params.discountSeedFromInvoice,
      ),
    )
  }

  const handleLineDiscountValueChange = (rowKey: string, value: string) => {
    params.setLineDiscountOverrides((previous) =>
      computeUpdatedLineDiscountValue(
        rowKey,
        value,
        previous,
        params.discountSeedFromInvoice,
      ),
    )
  }

  const handleReopenTask = (taskId: string) => {
    params.setIsCheckoutOpen(false)
    params.onReopenTask?.(taskId)
  }

  const closeCheckout = () => params.setIsCheckoutOpen(false)

  return {
    handleCheckoutAction,
    handleCreateDraftInCheckout,
    handleIssueInvoiceInCheckout,
    handleToggleGroup,
    handleTaskDiscountValueChange,
    handleLineDiscountTypeChange,
    handleLineDiscountValueChange,
    handleReopenTask,
    closeCheckout,
  }
}

export function buildWorkshopCheckoutChrome(params: {
  isCheckoutOpen: boolean
  activeInvoiceId: string | null | undefined
  fetchedInvoice: Invoice | null | undefined
  checkoutGrossTotal: number
  orderGrandTotal: number
  primaryCheckoutActionLabel: string
  handlers: ReturnType<typeof createWorkshopCheckoutEventHandlers>
  isInvoiceLoading: boolean
  isLocked: boolean
  canCreateDraftInCheckout: boolean
  canIssueInvoiceInCheckout: boolean
  createDraftPending: boolean
  issuePending: boolean
  groupedCheckoutTasks: GroupedCheckoutTask[]
  expandedTaskGroups: Record<string, boolean>
  taskDiscountOverrides: Record<string, string>
  checkoutSubtotal: number
  checkoutDiscountTotal: number
  checkoutNetTotal: number
  checkoutTaxTotal: number
}): { checkoutFooterTotal: number; footerProps: CheckoutFooterProps } {
  const checkoutFooterTotal = resolveCheckoutFooterTotal(
    params.isCheckoutOpen,
    Boolean(params.activeInvoiceId && params.fetchedInvoice),
    params.checkoutGrossTotal,
    params.orderGrandTotal,
  )

  const footerProps = buildCheckoutFooterProps({
    checkoutFooterTotal,
    isCheckoutOpen: params.isCheckoutOpen,
    primaryActionLabel: params.primaryCheckoutActionLabel,
    onPrimaryAction: params.handlers.handleCheckoutAction,
    onClose: params.handlers.closeCheckout,
    activeInvoiceId: params.activeInvoiceId,
    fetchedInvoice: params.fetchedInvoice,
    isInvoiceLoading: params.isInvoiceLoading,
    isLocked: params.isLocked,
    canCreateDraftInCheckout: params.canCreateDraftInCheckout,
    canIssueInvoiceInCheckout: params.canIssueInvoiceInCheckout,
    createDraftPending: params.createDraftPending,
    issuePending: params.issuePending,
    groupedCheckoutTasks: params.groupedCheckoutTasks,
    expandedTaskGroups: params.expandedTaskGroups,
    taskDiscountOverrides: params.taskDiscountOverrides,
    checkoutSubtotal: params.checkoutSubtotal,
    checkoutDiscountTotal: params.checkoutDiscountTotal,
    checkoutNetTotal: params.checkoutNetTotal,
    checkoutTaxTotal: params.checkoutTaxTotal,
    checkoutGrossTotal: params.checkoutGrossTotal,
    onToggleGroup: params.handlers.handleToggleGroup,
    onTaskDiscountValueChange: params.handlers.handleTaskDiscountValueChange,
    onLineDiscountTypeChange: params.handlers.handleLineDiscountTypeChange,
    onLineDiscountValueChange: params.handlers.handleLineDiscountValueChange,
    onCreateDraftInvoice: () => void params.handlers.handleCreateDraftInCheckout(),
    onIssueInvoice: () => void params.handlers.handleIssueInvoiceInCheckout(),
    onReopenTask: params.handlers.handleReopenTask,
  })

  return { checkoutFooterTotal, footerProps }
}
