import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDraftEditPage from './InvoiceDraftEditPage'
import * as salesApi from '@/api/sales'
import * as inventoryApi from '@/api/inventory'
import type { Customer } from '@/api/types'

vi.mock('@/api/sales')
vi.mock('@/api/inventory')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { toast } from 'sonner'

vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({
    onChange,
  }: {
    onChange: (customer: Customer | null) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          id: 'cust-1',
          type: 'PRIVATE',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
        })
      }
    >
      Select customer
    </button>
  ),
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const mockInvoice = {
  id: 'inv-1',
  status: 'DRAFT',
  sales_order_id: 'so-1',
  customer_id: 'cust-1',
  customer: {
    id: 'cust-1',
    type: 'PRIVATE',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
  },
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '1',
  total_tax: '0.2',
  total_gross: '1.2',
  items: [
    {
      id: 'line-1',
      description: 'Brake pads',
      quantity: '1',
      unit_price: '1',
      tax_rate: '20',
      line_total: '1',
    },
  ],
}

describe('InvoiceDraftEditPage autosave', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: [] }, isLoading: false })
    asMock(salesApi.useInvoice).mockReturnValue({
      data: mockInvoice,
      isLoading: false,
      error: null,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sales/invoices/inv-1/edit']}>
          <Routes>
            <Route path="/sales/invoices/:id/edit" element={<InvoiceDraftEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('auto-saves draft updates for a sales-order-sourced invoice', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.change(screen.getByDisplayValue('Brake pads'), {
      target: { value: 'Brake pads premium' },
    })

    await waitFor(
      () => {
        expect(updateMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'inv-1',
            payload: expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({ description: 'Brake pads premium' }),
              ]),
            }),
          }),
        )
      },
      { timeout: 2000 },
    )

    expect(await screen.findByText('All changes saved')).toBeInTheDocument()
  })

  it('surfaces API code and message when autosave fails', async () => {
    const updateMutation = vi.fn().mockRejectedValue(
      new Error(
        'SOURCE_DOCUMENT_REQUIRED: Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
      ),
    )
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.change(screen.getByDisplayValue('Brake pads'), {
      target: { value: 'Updated line' },
    })

    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalledWith('Auto-save failed', {
          description: expect.stringContaining('SOURCE_DOCUMENT_REQUIRED'),
        })
      },
      { timeout: 3000 },
    )
  })
})
