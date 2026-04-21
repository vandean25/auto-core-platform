import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PurchaseBillForm } from './PurchaseBillForm'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as purchaseApi from '@/api/usePurchaseInvoices'
import * as vendorApi from '@/api/vendors'
import * as inventoryApi from '@/api/inventory'
import type { PurchaseInvoice } from '@/api/types'

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

    const input = screen.getByLabelText('Vendor Bill #')
    fireEvent.change(input, { target: { value: 'INV-UPDATED' } })

    // Wait for debounce (750ms)
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
    
    // Line 1: 1 * 100 = 100
    // Tax 20%: 20
    // Total: 120
    expect(screen.getByText('€100.00')).toBeInTheDocument() // Subtotal
    expect(screen.getByText('€20.00')).toBeInTheDocument() // Tax
    expect(screen.getByText('€120.00')).toBeInTheDocument() // Grand Total
  })
})
