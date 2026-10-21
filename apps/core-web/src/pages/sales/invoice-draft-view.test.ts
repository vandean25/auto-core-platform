import { describe, expect, it } from 'vitest'
import type { Invoice } from '@/api/types'
import { getInvoiceDraftView } from './invoice-draft-view'

const draft = { id: 'inv-1', status: 'DRAFT', sales_order_id: 'so-1' } as unknown as Invoice

const viewFor = (overrides: Partial<Parameters<typeof getInvoiceDraftView>[0]>) =>
  getInvoiceDraftView({ invoiceId: 'inv-1', invoice: draft, isLoading: false, error: null, ...overrides })

describe('getInvoiceDraftView', () => {
  it('asks for an invoice id before anything else', () => {
    expect(viewFor({ invoiceId: undefined, isLoading: true }).view).toBe('notFound')
  })

  it('shows loading while the invoice is fetched', () => {
    expect(viewFor({ invoice: undefined, isLoading: true }).view).toBe('loading')
  })

  it('shows a load failure on a query error, even when an invoice is at hand', () => {
    expect(viewFor({ error: new Error('boom') }).view).toBe('loadFailed')
  })

  it('shows a load failure when no invoice came back', () => {
    expect(viewFor({ invoice: undefined }).view).toBe('loadFailed')
  })

  it('treats a draft without a sales order as unsupported', () => {
    const unlinked = { ...draft, sales_order_id: null } as unknown as Invoice
    expect(viewFor({ invoice: unlinked }).view).toBe('unsupported')
  })

  it('treats an invoice that is no longer a draft as not editable', () => {
    const finalized = { ...draft, status: 'FINALIZED' } as unknown as Invoice
    expect(viewFor({ invoice: finalized }).view).toBe('notEditable')
  })

  it('opens a draft linked to a sales order and hands back its invoice', () => {
    const result = viewFor({})
    expect(result.view).toBe('editable')
    expect(result.invoice).toBe(draft)
  })
})
