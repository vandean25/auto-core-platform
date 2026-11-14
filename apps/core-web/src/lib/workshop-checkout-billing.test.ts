import { describe, it, expect } from 'vitest'
import type { InvoiceItem, WorkshopTask, WorkshopTaskLineItem } from '@/api/types'
import {
  buildBillableCheckoutLineRows,
  computeCheckoutInvoiceTaxTotal,
  computeUnroundedLineTax,
  findInvoiceItemForWorkshopLine,
  resolveCheckoutFooterTotal,
  resolveCheckoutLineTaxRate,
  WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE,
} from './workshop-checkout-billing'

const laborLine = (
  id: string,
  unitPrice = 90,
): WorkshopTaskLineItem => ({
  id,
  type: 'LABOR',
  itemNo: 'LAB-1',
  description: 'Labor',
  qty: 1,
  unitPrice,
})

const partLine = (
  id: string,
  partExecutionStatus?: WorkshopTaskLineItem['partExecutionStatus'],
): WorkshopTaskLineItem => ({
  id,
  type: 'PART',
  itemNo: 'P-1',
  description: 'Part',
  qty: 1,
  unitPrice: 50,
  ...(partExecutionStatus ? { partExecutionStatus } : {}),
})

describe('workshop-checkout-billing', () => {
  describe('computeCheckoutInvoiceTaxTotal', () => {
    it('rounds summed unrounded line tax once (invoice total_tax parity)', () => {
      expect(
        computeCheckoutInvoiceTaxTotal([
          { lineNet: 10.02, taxRatePercent: 20 },
          { lineNet: 10.02, taxRatePercent: 20 },
        ]),
      ).toBe(4.01)
    })

    it('computes 20% VAT for a single line', () => {
      expect(computeUnroundedLineTax(90, 20)).toBe(18)
      expect(computeCheckoutInvoiceTaxTotal([{ lineNet: 90, taxRatePercent: 20 }])).toBe(18)
    })
  })

  describe('buildBillableCheckoutLineRows', () => {
    it('omits cancelled part lines', () => {
      const tasks = [
        {
          id: 'task-1',
          title: 'T',
          lineItemsVersion: 0,
          status: 'DONE' as const,
          done: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          lineItems: [partLine('p-cancel', 'CANCELLED'), laborLine('l-1')],
        },
      ] as WorkshopTask[]
      const rows = buildBillableCheckoutLineRows(tasks)
      expect(rows).toHaveLength(1)
      expect(rows[0].lineItem.id).toBe('l-1')
    })
  })

  describe('findInvoiceItemForWorkshopLine', () => {
    it('matches by workshop_task_line_item_id when invoice ids differ', () => {
      const invoiceItems = [
        {
          id: 'draft-line-aaa',
          workshop_task_line_item_id: 'workshop-line-111',
          description: 'Labor',
          quantity: '1',
          unit_price: '90',
          tax_rate: 20,
        },
        {
          id: 'draft-line-bbb',
          workshop_task_line_item_id: 'workshop-line-222',
          description: 'Labor 2',
          quantity: '1',
          unit_price: '40',
          tax_rate: 0,
        },
      ] as InvoiceItem[]

      expect(findInvoiceItemForWorkshopLine(invoiceItems, 'workshop-line-111')?.tax_rate).toBe(20)
      expect(findInvoiceItemForWorkshopLine(invoiceItems, 'workshop-line-222')?.tax_rate).toBe(0)
    })

    it('falls back to equal invoice item id for legacy fixtures', () => {
      const legacyItems = [
        { id: 'line-1', description: 'x', quantity: '1', unit_price: '1', tax_rate: 20 },
      ] as InvoiceItem[]
      expect(findInvoiceItemForWorkshopLine(legacyItems, 'line-1')?.id).toBe('line-1')
    })
  })

  describe('resolveCheckoutLineTaxRate', () => {
    it('defaults to workshop VAT when no invoice line', () => {
      expect(resolveCheckoutLineTaxRate(undefined)).toBe(WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE)
    })

    it('honours explicit 0% on the invoice line', () => {
      expect(
        resolveCheckoutLineTaxRate({
          id: 'i',
          description: 'x',
          quantity: '1',
          unit_price: '1',
          tax_rate: 0,
        }),
      ).toBe(0)
    })
  })

  describe('resolveCheckoutFooterTotal', () => {
    it('returns net kind with orderGrandTotal when checkout is closed and no invoice is loaded', () => {
      expect(resolveCheckoutFooterTotal(false, false, 180, 150)).toEqual({
        amount: 150,
        kind: 'net',
      })
    })

    it('returns gross kind with checkoutGrossTotal when checkout is open', () => {
      expect(resolveCheckoutFooterTotal(true, false, 180, 150)).toEqual({
        amount: 180,
        kind: 'gross',
      })
    })

    it('returns gross kind with checkoutGrossTotal when an invoice is loaded', () => {
      expect(resolveCheckoutFooterTotal(false, true, 180, 150)).toEqual({
        amount: 180,
        kind: 'gross',
      })
    })
  })
})
