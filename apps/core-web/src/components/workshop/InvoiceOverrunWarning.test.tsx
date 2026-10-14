import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '@/api/auth-session'
import { useWorkshopOrderEstimate } from '@/api/workshop-estimates'
import { InvoiceOverrunWarning } from './InvoiceOverrunWarning'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/workshop-estimates', () => ({ useWorkshopOrderEstimate: vi.fn() }))

const sessionMock = vi.mocked(useAuthSession)
const estimateMock = vi.mocked(useWorkshopOrderEstimate)

function session(activeRole: string) {
  return { data: { activeRole } } as unknown as ReturnType<typeof useAuthSession>
}

function estimateWithNotice(requiresCustomerNotice: boolean) {
  return {
    data: {
      overrun_warning: {
        current_total_gross: '270.00',
        approved_total_gross: '216.00',
        requires_customer_notice: requiresCustomerNotice,
      },
    },
  } as unknown as ReturnType<typeof useWorkshopOrderEstimate>
}

describe('InvoiceOverrunWarning', () => {
  beforeEach(() => {
    sessionMock.mockReturnValue(session('SALES'))
    estimateMock.mockReturnValue(estimateWithNotice(true))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('warns while an invoice draft can be issued and the customer has not been told, and says the invoice can still be issued', () => {
    render(<InvoiceOverrunWarning orderId="order-1" canIssueInvoice />)

    expect(screen.getByTestId('invoice-overrun-warning')).toBeInTheDocument()
    expect(screen.getByText(/Der Kunde wurde noch nicht über die Abweichung informiert/)).toBeInTheDocument()
    expect(screen.getByText(/Die Rechnung kann trotzdem ausgestellt werden/)).toBeInTheDocument()
  })

  it('stays hidden for a role that cannot read estimates, and does not request the estimate', () => {
    sessionMock.mockReturnValue(session('TECH'))

    render(<InvoiceOverrunWarning orderId="order-1" canIssueInvoice />)

    expect(screen.queryByTestId('invoice-overrun-warning')).toBeNull()
    expect(estimateMock).not.toHaveBeenCalled()
  })

  it('stays hidden when no invoice draft can be issued, and does not request the estimate', () => {
    render(<InvoiceOverrunWarning orderId="order-1" canIssueInvoice={false} />)

    expect(screen.queryByTestId('invoice-overrun-warning')).toBeNull()
    expect(estimateMock).not.toHaveBeenCalled()
  })

  it('stays hidden once the customer has been told about the current total', () => {
    estimateMock.mockReturnValue(estimateWithNotice(false))

    render(<InvoiceOverrunWarning orderId="order-1" canIssueInvoice />)

    expect(screen.queryByTestId('invoice-overrun-warning')).toBeNull()
  })
})
