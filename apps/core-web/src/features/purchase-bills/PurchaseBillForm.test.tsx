import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import deFinance from '../../../../../locales/de/finance.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { vi, describe, it, expect, beforeEach } from 'vitest'

registerGermanUiForTests()
import { PurchaseBillForm } from './PurchaseBillForm'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as purchaseApi from '@/api/usePurchaseInvoices'
import * as vendorApi from '@/api/vendors'
import * as inventoryApi from '@/api/inventory'
import type { PurchaseInvoice } from '@/api/types'
import { formattedCurrencyPattern } from '@/test/format-assertions'

vi.mock('@/api/usePurchaseInvoices')
vi.mock('@/api/vendors')
vi.mock('@/api/inventory')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockInitialData = {
  id: 'bill-1',
  vendor_id: 'vendor-1',
  vendor_invoice_number: 'INV-001',
  invoice_date: '2026-03-29',
  due_date: '2026-04-28',
  status: 'DRAFT',
  lines: [
    {
      id: 'line-1',
      description: 'Part A',
      quantity: '1',
      unit_price: '100',
      tax_rate: 20,
    }
  ]
}

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

describe('PurchaseBillForm Characterization', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
    vi.clearAllMocks()
    asMock(purchaseApi.useUnbilledReceipts).mockReturnValue({ data: [], isLoading: false })
    asMock(vendorApi.useVendors).mockReturnValue({ data: { data: [{ id: 'vendor-1', name: 'Vendor One' }] }, isLoading: false })
    asMock(vendorApi.useVendor).mockReturnValue({ data: { id: 'vendor-1', name: 'Vendor One' }, isLoading: false })
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: [] }, isLoading: false })
    asMock(purchaseApi.useCreatePurchaseInvoice).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(purchaseApi.useUpdatePurchaseInvoice).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    asMock(purchaseApi.usePostPurchaseInvoice).mockReturnValue({ mutateAsync: vi.fn() })
    asMock(purchaseApi.useDeletePurchaseInvoiceLine).mockReturnValue({ mutateAsync: vi.fn() })
  })

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <PurchaseBillForm initialData={mockInitialData as unknown as PurchaseInvoice} onSuccess={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>
    )
  }

  it('triggers auto-save after vendor invoice number changes', async () => {
    const updateMutation = vi.fn().mockResolvedValue({ id: 'bill-1' })
    asMock(purchaseApi.useUpdatePurchaseInvoice).mockReturnValue({ mutateAsync: updateMutation, isPending: false })
    
    renderComponent()

    const input = screen.getByLabelText(deFinance.purchaseBills.form.vendorBillNumber)
    fireEvent.change(input, { target: { value: 'INV-UPDATED' } })

    await waitFor(() => {
      expect(updateMutation).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({
          vendorInvoiceNumber: 'INV-UPDATED',
        })
      }))
    }, { timeout: 2000 })
  })

  it('calculates totals correctly', async () => {
    renderComponent()

    const findSummaryCard = (label: string) =>
      screen
        .getAllByText(label)
        .map((element) => element.closest('div')?.parentElement)
        .find((element): element is HTMLElement => element instanceof HTMLElement)

    const itemsCard = findSummaryCard(deFinance.purchaseBills.form.summaryItems)
    const taxCard = findSummaryCard(deFinance.purchaseBills.form.summaryTax)
    const totalCard = findSummaryCard(deFinance.purchaseBills.form.summaryTotal)

    expect(itemsCard).not.toBeNull()
    expect(taxCard).not.toBeNull()
    expect(totalCard).not.toBeNull()

    expect(within(itemsCard as HTMLElement).getByText(formattedCurrencyPattern(100))).toBeInTheDocument()
    expect(within(taxCard as HTMLElement).getByText(formattedCurrencyPattern(20))).toBeInTheDocument()
    expect(within(totalCard as HTMLElement).getByText(formattedCurrencyPattern(120))).toBeInTheDocument()
  })
})
