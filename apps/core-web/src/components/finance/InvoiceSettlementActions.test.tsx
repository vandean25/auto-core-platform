import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useInvoiceSettlement } from '@/api/useInvoiceSettlement'
import { InvoiceSettlementActions } from './InvoiceSettlementActions'
import { InvoiceSettlementPanel } from './InvoiceSettlementPanel'
import deFinance from '../../../../../locales/de/finance.json'

vi.mock('@/api/useInvoiceSettlement', () => ({
  SettlementMutationError: class extends Error {},
  settlementSuccessToastMessageKey: () => undefined,
  useCancelFiscalReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  useInvoiceSettlement: vi.fn(),
  useRecordSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  useReconcileSettlement: () => ({ mutate: vi.fn(), isPending: false }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('fiscal settlement disabled (AUT-844)', () => {
  it('shows the compact fiscal-off line to settlement managers', () => {
    vi.mocked(useInvoiceSettlement).mockReturnValue({
      data: { rksvMode: 'OFF', payment: null },
      isLoading: false,
    } as unknown as ReturnType<typeof useInvoiceSettlement>)

    render(<InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="ISSUED" canManage />)

    expect(screen.getByText(deFinance.settlement.fiscalOff)).toBeInTheDocument()
  })

  it('renders nothing for read-only roles while fiscal settlement is off', () => {
    vi.mocked(useInvoiceSettlement).mockReturnValue({
      data: { rksvMode: 'OFF', payment: null },
      isLoading: false,
    } as unknown as ReturnType<typeof useInvoiceSettlement>)

    const { container } = render(
      <InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="ISSUED" canManage={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the settlement panel hidden while fiscal settlement is off', () => {
    render(<InvoiceSettlementPanel outstanding={100} payment={null} rksvMode="OFF" />)

    expect(screen.queryByText(deFinance.settlement.title)).not.toBeInTheDocument()
  })
})

describe('role without invoice permissions (AUT-852)', () => {
  it('renders no settlement block and no empty card while settlement data is still loading', () => {
    vi.mocked(useInvoiceSettlement).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useInvoiceSettlement>)

    const { container } = render(
      <InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="PAID" canManage={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

describe('compact settlement card (AUT-1036)', () => {
  it('shows the outstanding EUR amount without the explanatory sentence', () => {
    render(
      <InvoiceSettlementPanel
        outstanding={96}
        payment={null}
        rksvMode="REQUIRED_EXTERNAL_KASSE"
      />,
    )

    expect(screen.getByText('Offen: € 96,00')).toBeInTheDocument()
    expect(screen.queryByText(/für die Werkstattrechnung/)).not.toBeInTheDocument()
  })
})

describe('outstanding amount after a finalized credit note (AUT-1069)', () => {
  it('labels the outstanding amount, not the invoice gross, on the settlement panel', () => {
    render(<InvoiceSettlementPanel outstanding={100} payment={null} rksvMode="REQUIRED_EXTERNAL_KASSE" />)

    expect(screen.getByText('Offen: € 100,00')).toBeInTheDocument()
    expect(screen.queryByText(/120,00/)).not.toBeInTheDocument()
  })

  it('shows a short status label instead of an amount when nothing is outstanding', () => {
    render(<InvoiceSettlementPanel outstanding={0} payment={null} rksvMode="REQUIRED_EXTERNAL_KASSE" />)

    expect(screen.getByText(deFinance.settlement.nothingOutstanding)).toBeInTheDocument()
    expect(screen.queryByText(/Offen:/)).not.toBeInTheDocument()
  })

  it.each([
    ['0.00', false],
    ['100.00', true],
  ])('with outstanding %s the settle action is offered: %s', (outstanding, offered) => {
    vi.mocked(useInvoiceSettlement).mockReturnValue({
      data: { rksvMode: 'REQUIRED_EXTERNAL_KASSE', payment: null, outstanding },
      isLoading: false,
    } as unknown as ReturnType<typeof useInvoiceSettlement>)

    render(<InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="ISSUED" canManage />)

    const record = screen.queryByRole('button', { name: deFinance.actions.recordSettlement })
    expect(record !== null).toBe(offered)
  })
})

