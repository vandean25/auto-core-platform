import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import { InvoiceSettlementActions } from './InvoiceSettlementActions'

vi.mock('@/api/useInvoiceSettlement', () => ({
  useInvoiceSettlement: () => ({ data: undefined }),
  useRecordSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  useReconcileSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelFiscalReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  settlementSuccessToastMessageKey: () => null,
  SettlementMutationError: class extends Error {},
}))

registerGermanUiForTests()
afterEach(cleanup)

describe('InvoiceSettlementActions', () => {
  it('renders no settlement block and no empty card for a role without invoice permissions (AUT-852)', () => {
    const { container } = render(
      <InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="PAID" canManage={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
