import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { useUpdateInvoice } from '@/api/sales'
import type { Customer, Invoice } from '@/api/types'
import type { useInvoiceEditor } from '@/hooks/useInvoiceEditor'
import { useInvoiceDraftAutosave } from './useInvoiceDraftAutosave'

type Editor = ReturnType<typeof useInvoiceEditor>
type UpdateMutation = ReturnType<typeof useUpdateInvoice>

const customer = { id: 'cust-1', email: 'ada@example.com' } as unknown as Customer

const invoice = {
  id: 'inv-1',
  status: 'DRAFT',
  sales_order_id: 'so-1',
  customer,
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  notes: 'Danke',
  items: [
    {
      id: 'line-1',
      catalog_item_id: null,
      description: 'Brake pads',
      quantity: '1',
      unit_price: '1',
      tax_rate: '20',
    },
  ],
} as unknown as Invoice

const line = {
  tempId: 'line-1',
  id: 'line-1',
  catalog_item_id: undefined,
  description: 'Brake pads',
  quantity: 1,
  unit_price: 1,
  tax_rate: 20,
}

const editorWith = (overrides: Partial<Editor> = {}) =>
  ({
    customer,
    items: [line],
    hydrateFromSnapshot: vi.fn(),
    ...overrides,
  }) as unknown as Editor

const renderAutosave = (editor: Editor) =>
  renderHook(() =>
    useInvoiceDraftAutosave({
      invoiceId: 'inv-1',
      invoice,
      editor,
      updateInvoiceMutation: { mutateAsync: vi.fn() } as unknown as UpdateMutation,
    }),
  )

describe('useInvoiceDraftAutosave', () => {
  it('loads the saved draft into the editor', () => {
    const editor = editorWith()

    renderAutosave(editor)

    expect(editor.hydrateFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        customer,
        items: [
          expect.objectContaining({
            id: 'line-1',
            description: 'Brake pads',
            quantity: 1,
            unit_price: 1,
            tax_rate: 20,
          }),
        ],
      }),
    )
  })

  it('builds the draft payload from the editor, with the saved notes', () => {
    const { result } = renderAutosave(editorWith())

    expect(result.current.buildPayload()).toEqual({
      customerId: 'cust-1',
      items: [{ catalogItemId: undefined, description: 'Brake pads', quantity: 1, unitPrice: 1, taxRate: 20 }],
      notes: 'Danke',
    })
  })

  it('builds no payload without a customer', () => {
    const { result } = renderAutosave(editorWith({ customer: null }))

    expect(result.current.buildPayload()).toBeNull()
  })

  it('starts idle', () => {
    const { result } = renderAutosave(editorWith())

    expect(result.current.saveStatus).toBe('idle')
  })
})
