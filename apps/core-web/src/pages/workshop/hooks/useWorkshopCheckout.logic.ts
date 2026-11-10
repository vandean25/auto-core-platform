import { toast } from 'sonner'
import { parseDiscountValue } from '@/lib/discount'
import type { DiscountType, Invoice } from '@/api/types'
import { EMPTY_DISCOUNT_STATE, type DiscountState } from './useWorkshopCalculations'
import { findInvoiceItemForWorkshopLine } from '@/lib/workshop-checkout-billing'
import type { CheckoutFooterProps } from '../components/CheckoutFooter'
import { i18n } from '@/lib/i18n'
import { getErrorMessage } from '@/lib/error-utils'

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

    const invoiceItem = findInvoiceItemForWorkshopLine(
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
    ? i18n.t('checkout.openInvoice', { ns: 'workshop' })
    : i18n.t('checkout.primaryAction', { ns: 'workshop' })

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
    toast.success(
      i18n.t('checkout.toast.draftInvoiceCreated', {
        ns: 'workshop',
        number: invoice.invoice_number || invoice.id,
      }),
    )
    return invoice.id
  } catch (error: unknown) {
    toast.error(
      getErrorMessage(error, i18n.t('checkout.toast.draftInvoiceFailed', { ns: 'workshop' })),
    )
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
    toast.success(
      i18n.t('checkout.toast.invoiceIssued', {
        ns: 'workshop',
        number: invoice.invoice_number || invoice.id,
      }),
    )
  } catch (error: unknown) {
    toast.error(
      getErrorMessage(error, i18n.t('checkout.toast.invoiceIssueFailed', { ns: 'workshop' })),
    )
  }
}
