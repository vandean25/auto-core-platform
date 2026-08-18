import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceCreatePage from './InvoiceCreatePage'
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

describe('InvoiceCreatePage autosave', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: [] }, isLoading: false })
    asMock(salesApi.useFinalizeInvoice).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    asMock(salesApi.useUpdateInvoice).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <InvoiceCreatePage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('auto-saves a draft after customer and line item are entered', async () => {
    const createMutation = vi.fn().mockResolvedValue({ id: 'inv-1', status: 'DRAFT' })
    asMock(salesApi.useCreateInvoice).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Select customer' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }))
    fireEvent.change(screen.getByPlaceholderText('Service or Item Name'), {
      target: { value: 'Brake pads' },
    })

    await waitFor(
      () => {
        expect(createMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            customerId: 'cust-1',
            items: expect.arrayContaining([
              expect.objectContaining({ description: 'Brake pads' }),
            ]),
          }),
        )
      },
      { timeout: 2000 },
    )

    expect(await screen.findByText('All changes saved')).toBeInTheDocument()
  })
})
