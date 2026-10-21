import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { deSales } from '@/test/de-sales'
import { InvoiceDraftHeader } from './InvoiceDraftHeader'

type HeaderProps = ComponentProps<typeof InvoiceDraftHeader>

const headerProps = (overrides: Partial<HeaderProps> = {}): HeaderProps => ({
  salesOrderId: 'so-1',
  saveStatus: 'idle',
  salesOrderStatus: 'CONFIRMED',
  salesOrderBlocksFinalize: false,
  isValid: true,
  isFinalizeBusy: false,
  onFinalize: vi.fn(),
  ...overrides,
})

const renderHeader = (overrides: Partial<HeaderProps> = {}) =>
  render(
    <MemoryRouter>
      <InvoiceDraftHeader {...headerProps(overrides)} />
    </MemoryRouter>,
  )

describe('InvoiceDraftHeader', () => {
  it('links back to the sales order and titles the page', () => {
    renderHeader()

    expect(screen.getByRole('link', { name: deSales.invoices.draft.backToOrderAria })).toHaveAttribute(
      'href',
      '/sales-orders/so-1',
    )
    expect(screen.getByRole('heading', { name: deSales.invoices.draft.title })).toBeInTheDocument()
  })

  it('hands the finalize click to the caller', () => {
    const onFinalize = vi.fn()
    renderHeader({ onFinalize })

    fireEvent.click(screen.getByRole('button', { name: deSales.invoices.draft.finalize }))

    expect(onFinalize).toHaveBeenCalledTimes(1)
  })

  it('disables finalize while the draft is not valid', () => {
    renderHeader({ isValid: false })

    expect(screen.getByRole('button', { name: deSales.invoices.draft.finalize })).toBeDisabled()
  })

  it('disables finalize with a spinner while finalize is running', () => {
    renderHeader({ isFinalizeBusy: true })

    const finalizeButton = screen.getByRole('button', { name: deSales.invoices.draft.finalize })
    expect(finalizeButton).toBeDisabled()
    expect(finalizeButton.querySelector('.animate-spin')).not.toBeNull()
  })

  it('blocks finalize and explains why when the sales order is already invoiced', () => {
    renderHeader({ salesOrderStatus: 'INVOICED', salesOrderBlocksFinalize: true })

    const finalizeButton = screen.getByRole('button', { name: deSales.invoices.draft.finalize })
    expect(finalizeButton).toBeDisabled()
    expect(finalizeButton).toHaveAttribute('title', deSales.finalize.salesOrderBlocked)
    expect(screen.getByText(deSales.finalize.salesOrderBlocked)).toBeInTheDocument()
  })
})
