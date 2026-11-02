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
    render(<InvoiceSettlementPanel totalGross={100} payment={null} rksvMode="OFF" />)

    expect(screen.queryByText(deFinance.settlement.title)).not.toBeInTheDocument()
  })
})
