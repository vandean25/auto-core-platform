import { describe, it, expect } from 'vitest'
import type { InvoiceItem, WorkshopTaskLineItem } from '@/api/types'
import {
  computeCheckoutLineTax,
  findInvoiceItemForCheckoutRow,
  resolveCheckoutLineTaxRate,
  WORKSHOP_CHECKOUT_DEFAULT_VAT_RATE,
} from './workshop-checkout-billing'

const laborRow = (id: string): { lineItem: WorkshopTaskLineItem } => ({
  lineItem: {
    id,
    type: 'LABOR',
    itemNo: 'LAB-1',
    description: 'Labor',
    qty: 1,
    unitPrice: 90,
  },
})

const partRow = (id: string, partExecutionStatus?: WorkshopTaskLineItem['partExecutionStatus']) => ({
  lineItem: {
    id,
    type: 'PART' as const,
    itemNo: 'P-1',
    description: 'Part',
    qty: 1,
    unitPrice: 50,
    ...(partExecutionStatus ? { partExecutionStatus } : {}),
  },
})

describe('workshop-checkout-billing', () => {
  describe('computeCheckoutLineTax', () => {
    it('computes 20% VAT rounded half-up', () => {
      expect(computeCheckoutLineTax(90, 20)).toBe(18)
      expect(computeCheckoutLineTax(15, 21)).toBeCloseTo(3.15)
    })

    it('returns 0 for zero net or zero rate', () => {
      expect(computeCheckoutLineTax(0, 20)).toBe(0)
      expect(computeCheckoutLineTax(90, 0)).toBe(0)
    })
  })

  describe('findInvoiceItemForCheckoutRow', () => {
    const invoiceItems = [
      {
        id: 'draft-line-aaa',
        description: 'Labor',
        quantity: '1',
        unit_price: '90',
        tax_rate: 20,
      },
    ] as InvoiceItem[]

    it('matches by billable row order when workshop and invoice ids differ', () => {
      const rows = [laborRow('workshop-line-111')]
      expect(findInvoiceItemForCheckoutRow(invoiceItems, rows, 0)?.tax_rate).toBe(20)
    })

    it('still matches by equal ids for legacy callers', () => {
      const legacyItems = [
        { ...invoiceItems[0], id: 'line-1' },
      ] as InvoiceItem[]
      const rows = [laborRow('line-1')]
      expect(findInvoiceItemForCheckoutRow(legacyItems, rows, 0)?.id).toBe('line-1')
    })

    it('skips cancelled part lines for positional alignment', () => {
      const laborOnlyInvoice = [
        { id: 'i-2', description: 'Labor', quantity: '1', unit_price: '90', tax_rate: 20 },
      ] as InvoiceItem[]
      const rows = [
        partRow('p-cancel', 'CANCELLED'),
        laborRow('l-1'),
      ]
      expect(findInvoiceItemForCheckoutRow(laborOnlyInvoice, rows, 0)).toBeUndefined()
      expect(findInvoiceItemForCheckoutRow(laborOnlyInvoice, rows, 1)?.description).toBe('Labor')
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
})
