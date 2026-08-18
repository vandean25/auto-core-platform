import { describe, expect, it } from 'vitest'
import type { UnbilledReceiptItem } from '@/api/types'
import {
  applyBillLineUpdates,
  buildInvoiceItems,
  calculateBillTotals,
  groupReceiptSummaries,
  mapInvoiceLinesToBillLines,
  parseNumber,
  toLocalDateIsoString,
} from './bill-utils'
import type { BillLine } from './types'

const manualLine: BillLine = {
  tempId: 'line-1',
  source: 'manual',
  description: 'Part A',
  quantity: 1,
  unitCost: 100,
  taxRate: 20,
}

describe('parseNumber', () => {
  it('parses a finite number', () => {
    expect(parseNumber('12.5')).toBe(12.5)
  })

  it('returns the fallback for non-numeric input', () => {
    expect(parseNumber('abc', 7)).toBe(7)
  })
})

describe('toLocalDateIsoString', () => {
  it('converts a date-only string to a local midnight ISO timestamp', () => {
    expect(toLocalDateIsoString('2026-03-29')).toBe(new Date(2026, 2, 29).toISOString())
  })

  it('falls back to now when the input is invalid', () => {
    const before = Date.now()
    const result = Date.parse(toLocalDateIsoString('not-a-date'))
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(after)
  })
})

describe('calculateBillTotals', () => {
  it('computes net, tax, and grand total', () => {
    expect(calculateBillTotals([manualLine])).toEqual({
      subtotal: 100,
      taxTotal: 20,
      grandTotal: 120,
    })
  })

  it('returns zeros for an empty line list', () => {
    expect(calculateBillTotals([])).toEqual({
      subtotal: 0,
      taxTotal: 0,
      grandTotal: 0,
    })
  })
})

describe('groupReceiptSummaries', () => {
  it('groups unbilled items by purchase order and sorts by number', () => {
    const items: UnbilledReceiptItem[] = [
      {
        purchaseOrderItemId: 'poi-2',
        purchaseOrderId: 'po-b',
        purchaseOrderNumber: 'PO-2',
        catalogItemId: 'cat-2',
        catalogItemName: 'Filter',
        quantityReceived: 2,
        quantityInvoiced: 0,
        quantityPending: 2,
        lastUnitCost: 10,
      },
      {
        purchaseOrderItemId: 'poi-1',
        purchaseOrderId: 'po-a',
        purchaseOrderNumber: 'PO-1',
        catalogItemId: 'cat-1',
        catalogItemName: 'Oil',
        quantityReceived: 1,
        quantityInvoiced: 0,
        quantityPending: 1,
        lastUnitCost: 5,
      },
      {
        purchaseOrderItemId: 'poi-3',
        purchaseOrderId: 'po-a',
        purchaseOrderNumber: 'PO-1',
        catalogItemId: 'cat-3',
        catalogItemName: 'Gasket',
        quantityReceived: 3,
        quantityInvoiced: 1,
        quantityPending: 2,
        lastUnitCost: 4,
      },
    ]

    expect(groupReceiptSummaries(items)).toEqual([
      {
        id: 'po-a',
        number: 'PO-1',
        lineCount: 2,
        pendingQuantity: 3,
        pendingAmount: 13,
      },
      {
        id: 'po-b',
        number: 'PO-2',
        lineCount: 1,
        pendingQuantity: 2,
        pendingAmount: 20,
      },
    ])
  })
})

describe('mapInvoiceLinesToBillLines', () => {
  it('maps persisted invoice lines onto editor rows', () => {
    const mapped = mapInvoiceLinesToBillLines([
      {
        id: 'line-1',
        purchase_invoice_id: 'bill-1',
        purchase_order_item_id: 'poi-1',
        purchase_order_item: {
          id: 'poi-1',
          purchase_order_id: 'po-1',
          purchase_order: { id: 'po-1', order_number: 'PO-1' },
        },
        description: 'Part A',
        quantity: '2',
        unit_price: '50',
        tax_rate: 20,
        line_total: '120',
      },
    ])

    expect(mapped).toEqual([
      {
        tempId: 'line-1',
        source: 'receipt',
        receiptId: 'po-1',
        receiptNumber: 'PO-1',
        purchaseOrderItemId: 'poi-1',
        description: 'Part A',
        quantity: 2,
        unitCost: 50,
        taxRate: 20,
      },
    ])
  })

  it('marks lines without a purchase order item as manual', () => {
    const mapped = mapInvoiceLinesToBillLines([
      {
        id: 'line-2',
        purchase_invoice_id: 'bill-1',
        description: 'Shop supply',
        quantity: '1',
        unit_price: '10',
        tax_rate: 0,
        line_total: '10',
      },
    ])

    expect(mapped[0]?.source).toBe('manual')
    expect(mapped[0]?.purchaseOrderItemId).toBeUndefined()
  })
})

describe('buildInvoiceItems', () => {
  it('trims descriptions and maps editor fields onto the API payload', () => {
    expect(
      buildInvoiceItems([
        {
          ...manualLine,
          purchaseOrderItemId: 'poi-1',
          description: '  Part A  ',
        },
      ]),
    ).toEqual([
      {
        purchaseOrderItemId: 'poi-1',
        description: 'Part A',
        quantity: 1,
        unitPrice: 100,
        taxRate: 20,
      },
    ])
  })
})

describe('applyBillLineUpdates', () => {
  it('clamps quantity to maxQuantity when present', () => {
    const next = applyBillLineUpdates(
      { ...manualLine, maxQuantity: 2, quantity: 1 },
      { quantity: 9 },
    )
    expect(next.quantity).toBe(2)
  })

  it('does not allow negative quantity, unit cost, or tax rate', () => {
    const next = applyBillLineUpdates(manualLine, {
      quantity: -1,
      unitCost: -4,
      taxRate: -3,
    })
    expect(next).toMatchObject({ quantity: 0, unitCost: 0, taxRate: 0 })
  })
})
