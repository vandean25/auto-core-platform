import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SalesOrderCreate from './SalesOrderCreate'
import * as salesOrdersApi from '@/api/sales-orders'
import * as inventoryApi from '@/api/inventory'
import * as customersApi from '@/api/customers'
import type { Customer } from '@/api/types'

const mockNavigate = vi.fn()

vi.mock('@/api/sales-orders')
vi.mock('@/api/inventory')
vi.mock('@/api/customers')
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({
    value,
    onChange,
  }: {
    value?: Customer | null
    onChange: (customer: Customer | null) => void
  }) => (
    <div>
      <span data-testid="customer-search-value">
        {value ? `${value.first_name} ${value.last_name}`.trim() : 'No customer'}
      </span>
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
    </div>
  ),
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

describe('SalesOrderCreate autosave', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    mockNavigate.mockReset()
    asMock(inventoryApi.useInventory).mockReturnValue({ data: { data: [] }, isLoading: false })
    asMock(customersApi.useCustomer).mockReturnValue({ data: undefined, isLoading: false })
    asMock(salesOrdersApi.useUpdateSalesOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SalesOrderCreate />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('shows the selected customer instead of a loading placeholder', async () => {
    asMock(salesOrdersApi.useCreateSalesOrder).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: 'so-1', order_number: 'SO-2026-0001' }),
      isPending: false,
    })

    renderPage()

    expect(screen.getByTestId('customer-search-value')).toHaveTextContent('No customer')
    fireEvent.click(screen.getByRole('button', { name: 'Select customer' }))
    expect(screen.getByTestId('customer-search-value')).toHaveTextContent('Ada Lovelace')
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })

  it('auto-saves a draft after a customer is selected', async () => {
    const createMutation = vi.fn().mockResolvedValue({ id: 'so-1', order_number: 'SO-2026-0001' })
    asMock(salesOrdersApi.useCreateSalesOrder).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Select customer' }))

    await waitFor(
      () => {
        expect(createMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            customer_id: 'cust-1',
          }),
        )
      },
      { timeout: 2000 },
    )

    expect(await screen.findByText('All changes saved')).toBeInTheDocument()
  })

  it('flushes a pending autosave before navigating on Done', async () => {
    vi.useFakeTimers()
    const createMutation = vi.fn().mockResolvedValue({
      id: 'so-1',
      order_number: 'SO-2026-0001',
    })
    asMock(salesOrdersApi.useCreateSalesOrder).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Select customer' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(createMutation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(createMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'cust-1',
      }),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/sales-orders/so-1')
  })
})
