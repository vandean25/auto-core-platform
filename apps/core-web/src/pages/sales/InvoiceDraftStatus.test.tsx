import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Invoice } from '@/api/types'
import { deSales } from '@/test/de-sales'
import { InvoiceDraftStatus } from './InvoiceDraftStatus'

const invoice = { id: 'inv-1' } as unknown as Invoice

const renderStatus = (view: Parameters<typeof InvoiceDraftStatus>[0]['view'], error: unknown = null) =>
  render(
    <MemoryRouter>
      <InvoiceDraftStatus view={view} invoice={invoice} error={error} />
    </MemoryRouter>,
  )

describe('InvoiceDraftStatus', () => {
  it('shows the not-found notice', () => {
    renderStatus('notFound')

    expect(screen.getByText(deSales.invoices.draft.notFound)).toBeInTheDocument()
  })

  it('shows the loading notice', () => {
    renderStatus('loading')

    expect(screen.getByText(deSales.invoices.draft.loading)).toBeInTheDocument()
  })

  it('shows the load failure text for the error', () => {
    renderStatus('loadFailed', new Error('boom'))

    expect(screen.getByText(deSales.errors.loadFailed)).toBeInTheDocument()
  })

  it('explains an unsupported draft and links back to the invoice', () => {
    renderStatus('unsupported')

    expect(screen.getByRole('heading', { name: deSales.invoices.draft.unsupportedTitle })).toBeInTheDocument()
    expect(screen.getByText(deSales.invoices.draft.unsupportedDescription)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: deSales.invoices.draft.viewInvoice })).toHaveAttribute(
      'href',
      '/sales/invoices/inv-1',
    )
  })

  it('explains a draft that is no longer editable and links back to the invoice', () => {
    renderStatus('notEditable')

    expect(screen.getByRole('heading', { name: deSales.invoices.draft.notEditableTitle })).toBeInTheDocument()
    expect(screen.getByText(deSales.invoices.draft.notEditableDescription)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: deSales.invoices.draft.viewInvoice })).toHaveAttribute(
      'href',
      '/sales/invoices/inv-1',
    )
  })
})
