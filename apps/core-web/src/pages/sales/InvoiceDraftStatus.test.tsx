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
  // Regression: the not-found notice was a bare text block, not the shared Empty.
  it('WHEN the invoice draft does not exist THEN the shared Empty is shown with the German text', () => {
    const { container } = renderStatus('notFound')

    expect(container.querySelector('[data-slot="empty"]')).toHaveTextContent(deSales.invoices.draft.notFound)
  })

  // Regression: the loading state was a bare text block instead of a skeleton.
  it('WHEN the invoice draft is loading THEN a Skeleton is shown instead of the loading text', async () => {
    const { container } = renderStatus('loading')

    expect(await screen.findByRole('status')).toHaveTextContent(deSales.invoices.draft.loading)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
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
