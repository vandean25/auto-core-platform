import type { PurchaseInvoiceLine, PurchaseInvoiceLineDto, UnbilledReceiptItem } from '@/api/types'
import type { BillLine, ReceiptSummary } from './types'

export const DEFAULT_TAX_RATE = 20
export const AUTO_SAVE_DEBOUNCE_MS = 750

export function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function toLocalDateIsoString(dateInput: string) {
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

export function calculateBillTotals(lines: BillLine[]) {
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
}

export function groupReceiptSummaries(unbilledItems: UnbilledReceiptItem[]): ReceiptSummary[] {
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
}

export function mapInvoiceLinesToBillLines(lines: PurchaseInvoiceLine[]): BillLine[] {
  return lines.map((line) => ({
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

export function buildInvoiceItems(lines: BillLine[]): PurchaseInvoiceLineDto[] {
  return lines.map((line) => ({
    purchaseOrderItemId: line.purchaseOrderItemId,
    description: line.description.trim(),
    quantity: line.quantity,
    unitPrice: line.unitCost,
    taxRate: line.taxRate,
  }))
}

export function applyBillLineUpdates(line: BillLine, updates: Partial<BillLine>): BillLine {
  const nextLine = { ...line, ...updates }
  if (typeof nextLine.maxQuantity === 'number' && nextLine.quantity > nextLine.maxQuantity) {
    nextLine.quantity = nextLine.maxQuantity
  }
  if (nextLine.quantity < 0) nextLine.quantity = 0
  if (nextLine.unitCost < 0) nextLine.unitCost = 0
  if (nextLine.taxRate < 0) nextLine.taxRate = 0
  return nextLine
}
