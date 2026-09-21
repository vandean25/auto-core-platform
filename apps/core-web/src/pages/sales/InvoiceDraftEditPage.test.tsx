import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import InvoiceDraftEditPage from './InvoiceDraftEditPage'
import * as salesApi from '@/api/sales'
import * as inventoryApi from '@/api/inventory'
import type { Customer } from '@/api/types'
import { DOCUMENT_AUTOSAVE_DEBOUNCE_MS } from '@/hooks/useDebouncedAutoSave'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

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
  const invoiceRef = { current: mockInvoice as typeof mockInvoice }

  beforeEach(() => {
    invoiceRef.current = { ...mockInvoice, items: [{ ...mockInvoice.items[0] }] }
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    mockNavigate.mockReset()
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: [] }, isLoading: false })
    asMock(salesApi.useInvoice).mockImplementation(() => ({
      data: invoiceRef.current,
      isLoading: false,
      error: null,
    }))
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
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

    fireEvent.change(screen.getByPlaceholderText('Service or Item Name'), {
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

  it('does not PATCH an unchanged draft on open', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()
    await screen.findByDisplayValue('Brake pads')

    await new Promise((resolve) => {
      setTimeout(resolve, DOCUMENT_AUTOSAVE_DEBOUNCE_MS + 100)
    })

    expect(updateMutation).not.toHaveBeenCalled()
  })

  it('does not re-hydrate from a refetched invoice object while the user is editing', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    const { rerender } = renderPage()
    await screen.findByDisplayValue('Brake pads')

    fireEvent.change(screen.getByPlaceholderText('Service or Item Name'), {
      target: { value: 'User typed value' },
    })

    const callsAfterEdit = updateMutation.mock.calls.length

    invoiceRef.current = {
      ...mockInvoice,
      items: [{ ...mockInvoice.items[0], description: 'Brake pads' }],
    }
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sales/invoices/inv-1/edit']}>
          <Routes>
            <Route path="/sales/invoices/:id/edit" element={<InvoiceDraftEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByDisplayValue('User typed value')).toBeInTheDocument()
    expect(updateMutation.mock.calls.length).toBe(callsAfterEdit)
  })

  it('calls finalize after confirm and navigates only on success', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalizeMutation = vi.fn().mockResolvedValue({
      ...mockInvoice,
      status: 'FINALIZED',
      invoice_number: 'RE-2026-0001',
    })
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Finalize & Print/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Finalize & Print$/i }))

    await waitFor(() => {
      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv-1',
        }),
      )
      expect(finalizeMutation).toHaveBeenCalledWith('inv-1')
      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
      expect(toast.success).toHaveBeenCalledWith('Invoice finalized and number generated!')
    })
  })

  it('surfaces Nest API errors when finalize fails and does not navigate', async () => {
    const updateMutation = vi.fn().mockResolvedValue(mockInvoice)
    const finalizeMutation = vi
      .fn()
      .mockRejectedValue(new Error('ACCOUNTING_MAPPING_INCOMPLETE: Accounting mapping is incomplete'))
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: finalizeMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Finalize & Print/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Finalize & Print$/i }))

    await waitFor(() => {
      expect(finalizeMutation).toHaveBeenCalledWith('inv-1')
      expect(toast.error).toHaveBeenCalledWith(
        'ACCOUNTING_MAPPING_INCOMPLETE: Accounting mapping is incomplete',
      )
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  it('surfaces API message when autosave fails', async () => {
    const updateMutation = vi.fn().mockRejectedValue(
      new Error(
        'Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
      ),
    )
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: updateMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.change(screen.getByPlaceholderText('Service or Item Name'), {
      target: { value: 'Updated line' },
    })

    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalledWith('Auto-save failed', {
          description: expect.stringContaining('Direct source-less invoice creation is not supported'),
        })
      },
      { timeout: 3000 },
    )
  })
})
