import type { InvoiceItem, WorkshopTaskLineItem } from '@/api/types'

/** Matches `DEFAULT_VAT_RATE` in `invoice-creation.helpers.ts` (server default). */
export const WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE = 20

export function roundMoneyHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function computeCheckoutLineTax(lineNet: number, taxRatePercent: number): number {
  if (lineNet <= 0 || taxRatePercent <= 0) return 0
  return roundMoneyHalfUp(lineNet * (taxRatePercent / 100))
}

export function isBillableWorkshopCheckoutLine(lineItem: WorkshopTaskLineItem): boolean {
  return lineItem.partExecutionStatus !== 'CANCELLED'
}

export function findInvoiceItemByLineItemId(
  invoiceItems: InvoiceItem[],
  lineItemId: string,
): InvoiceItem | undefined {
  return invoiceItems.find((item) => item.id === lineItemId)
}

/**
 * Resolves the invoice draft line that bills a workshop checkout row. Invoice item
 * IDs are new UUIDs at draft creation, so match by stable billable line order (same
 * as `buildDraftInvoiceLinesFromOrder` on the server) and keep id equality for tests.
 */
export function findInvoiceItemForCheckoutRow(
  invoiceItems: InvoiceItem[],
  checkoutLineRows: Array<{ lineItem: WorkshopTaskLineItem }>,
  rowIndex: number,
): InvoiceItem | undefined {
  const row = checkoutLineRows[rowIndex]
  if (!row || !isBillableWorkshopCheckoutLine(row.lineItem)) return undefined

  const byId = findInvoiceItemByLineItemId(invoiceItems, row.lineItem.id)
  if (byId) return byId

  const billableBeforeRow = checkoutLineRows
    .slice(0, rowIndex + 1)
    .filter((entry) => isBillableWorkshopCheckoutLine(entry.lineItem)).length - 1

  return invoiceItems[billableBeforeRow]
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
