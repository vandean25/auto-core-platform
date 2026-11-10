import type { InvoiceItem, WorkshopTask, WorkshopTaskLineItem } from '@/api/types'

/** Matches `DEFAULT_VAT_RATE` in `invoice-creation.helpers.ts` (server default). */
export const WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE = 20

export function roundMoneyHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Unrounded line tax (same formula as server `calculateInvoiceTotals`). */
export function computeUnroundedLineTax(lineNet: number, taxRatePercent: number): number {
  if (lineNet <= 0 || taxRatePercent <= 0) return 0
  return lineNet * (taxRatePercent / 100)
}

/** Round half-up once on the summed unrounded line taxes (matches invoice `total_tax`). */
export function computeCheckoutInvoiceTaxTotal(
  lines: Array<{ lineNet: number; taxRatePercent: number }>,
): number {
  const unroundedSum = lines.reduce(
    (sum, line) => sum + computeUnroundedLineTax(line.lineNet, line.taxRatePercent),
    0,
  )
  return roundMoneyHalfUp(unroundedSum)
}

export function isBillableWorkshopCheckoutLine(lineItem: WorkshopTaskLineItem): boolean {
  return lineItem.partExecutionStatus !== 'CANCELLED'
}

export function compareWorkshopTasksForBilling(a: WorkshopTask, b: WorkshopTask): number {
  const aCreated = a.createdAt ? Date.parse(a.createdAt) : 0
  const bCreated = b.createdAt ? Date.parse(b.createdAt) : 0
  if (aCreated !== bCreated) return aCreated - bCreated
  return a.id.localeCompare(b.id)
}

export function compareWorkshopLineItemsForBilling(
  a: WorkshopTaskLineItem,
  b: WorkshopTaskLineItem,
): number {
  return a.id.localeCompare(b.id)
}

export interface CheckoutLineRow {
  rowKey: string
  taskId: string
  lineItem: WorkshopTaskLineItem
}

export function buildBillableCheckoutLineRows(tasks: WorkshopTask[]): CheckoutLineRow[] {
  const sortedTasks = [...tasks].sort(compareWorkshopTasksForBilling)
  return sortedTasks.flatMap((task) =>
    [...(task.lineItems ?? [])]
      .filter(isBillableWorkshopCheckoutLine)
      .sort(compareWorkshopLineItemsForBilling)
      .map((lineItem, index) => ({
        rowKey: `${task.id}:${lineItem.id ?? `idx-${index}`}`,
        taskId: task.id,
        lineItem,
      })),
  )
}

export function findInvoiceItemByLineItemId(
  invoiceItems: InvoiceItem[],
  lineItemId: string,
): InvoiceItem | undefined {
  return invoiceItems.find((item) => item.id === lineItemId)
}

export function findInvoiceItemForWorkshopLine(
  invoiceItems: InvoiceItem[],
  workshopLineId: string,
): InvoiceItem | undefined {
  const byWorkshopLine = invoiceItems.find(
    (item) => item.workshop_task_line_item_id === workshopLineId,
  )
  if (byWorkshopLine) return byWorkshopLine
  return findInvoiceItemByLineItemId(invoiceItems, workshopLineId)
}

export function resolveCheckoutLineTaxRate(
  invoiceItem: InvoiceItem | undefined,
): number {
  if (invoiceItem) {
    const rate = Number(invoiceItem.tax_rate)
    return Number.isFinite(rate) ? rate : WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE
  }
  return WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE
}

export function resolveCheckoutFooterTotal(
  isCheckoutOpen: boolean,
  hasLoadedInvoice: boolean,
  checkoutGrossTotal: number,
  orderGrandTotal: number,
): number {
  if (isCheckoutOpen || hasLoadedInvoice) return checkoutGrossTotal
  return orderGrandTotal
}
