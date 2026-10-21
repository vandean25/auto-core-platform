import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Customer } from '@/api/types'
import type { useInvoiceEditor } from '@/hooks/useInvoiceEditor'
import { deSales } from '@/test/de-sales'
import { InvoiceDraftParties } from './InvoiceDraftParties'

vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: () => null,
}))

type Editor = ReturnType<typeof useInvoiceEditor>

const customer = {
  id: 'cust-1',
  email: 'ada@example.com',
  address_street: 'Hauptstraße 1',
  address_zip: '4020',
  address_city: 'Linz',
  address_country: 'Österreich',
} as unknown as Customer

const editorWith = (overrides: Partial<Editor> = {}) =>
  ({
    customer: null,
    setCustomer: vi.fn(),
    date: new Date(2026, 8, 21),
    setDate: vi.fn(),
    dueDate: new Date(2026, 9, 5),
    setDueDate: vi.fn(),
    ...overrides,
  }) as unknown as Editor

describe('InvoiceDraftParties', () => {
  it('shows the customer address and email once a customer is picked', () => {
    render(<InvoiceDraftParties editor={editorWith({ customer })} />)

    expect(screen.getByText('Hauptstraße 1')).toBeInTheDocument()
    expect(screen.getByText('4020 Linz')).toBeInTheDocument()
    expect(screen.getByText('Österreich')).toBeInTheDocument()
    expect(screen.getByText('E-Mail: ada@example.com')).toBeInTheDocument()
  })

  it('falls back to a placeholder when the customer has no street', () => {
    const withoutStreet = { ...customer, address_street: null } as unknown as Customer
    render(<InvoiceDraftParties editor={editorWith({ customer: withoutStreet })} />)

    expect(screen.getByText(deSales.invoices.draft.noStreet)).toBeInTheDocument()
  })

  it('shows no address block without a customer', () => {
    render(<InvoiceDraftParties editor={editorWith()} />)

    expect(screen.queryByText('E-Mail: ada@example.com')).not.toBeInTheDocument()
  })

  it('shows the invoice and due dates and passes changes to the editor', () => {
    const editor = editorWith()
    render(<InvoiceDraftParties editor={editor} />)

    fireEvent.change(screen.getByDisplayValue('2026-09-21'), { target: { value: '2026-09-25' } })
    fireEvent.change(screen.getByDisplayValue('2026-10-05'), { target: { value: '2026-10-20' } })

    expect(editor.setDate).toHaveBeenCalledWith(new Date('2026-09-25'))
    expect(editor.setDueDate).toHaveBeenCalledWith(new Date('2026-10-20'))
  })
})
