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

const editorWith = (overrides: Partial<Editor> = {}) =>
  ({
    customer,
    items: [],
    hydrateFromSnapshot: vi.fn(),
    ...overrides,
  }) as unknown as Editor

const renderAutosave = (editor: Editor = editorWith()) => {
  const buildPayload = vi.fn(() => null)
  const draftNotesRef: { current: string | undefined } = { current: undefined }
  const hook = renderHook(() =>
    useInvoiceDraftAutosave({
      invoiceId: 'inv-1',
      invoice,
      editor,
      updateInvoiceMutation: { mutateAsync: vi.fn() } as unknown as UpdateMutation,
      buildPayload,
      draftNotesRef,
    }),
  )
  return { ...hook, buildPayload, draftNotesRef }
}

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

  it('keeps the saved notes in the ref the page builds the payload from', () => {
    const { draftNotesRef } = renderAutosave()

    expect(draftNotesRef.current).toBe('Danke')
  })

  it('asks the page for the draft payload once the draft is loaded', () => {
    const { buildPayload } = renderAutosave()

    expect(buildPayload).toHaveBeenCalled()
  })

  it('starts idle', () => {
    const { result } = renderAutosave()

    expect(result.current.saveStatus).toBe('idle')
  })
})
