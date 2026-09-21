import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import SalesInvoiceNewPage from './SalesInvoiceNewPage'

describe('SalesInvoiceNewPage', () => {
  it('explains sales-order sourcing and does not offer standalone draft creation', () => {
    render(
      <MemoryRouter>
        <SalesInvoiceNewPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: /Sales invoices need a source order/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open sales orders/i })).toHaveAttribute(
      'href',
      '/sales-orders',
    )
    expect(screen.queryByRole('button', { name: /Add Line Item/i })).not.toBeInTheDocument()
  })
})
