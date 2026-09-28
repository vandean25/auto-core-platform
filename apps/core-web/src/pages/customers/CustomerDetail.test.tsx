import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomerDetail from './CustomerDetail'
import * as customersApi from '@/api/customers'

const mockNavigate = vi.fn()

vi.mock('@/api/customers')
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
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

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const mockCustomer = {
  id: 'cust-100',
  type: 'PRIVATE' as const,
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: '+43 123 456789',
  address_street: 'Musterstrasse 1',
  address_zip: '1010',
  address_city: 'Vienna',
  address_country: 'Austria',
  notes: 'VIP customer',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
  sales_orders: [
    {
      id: 'so-1',
      order_number: 'SO-2026-0001',
      status: 'CONFIRMED' as const,
      total_amount: 250,
      createdAt: '2026-02-01T10:00:00.000Z',
    },
  ],
  workshop_orders: [
    {
      id: 'wo-1',
      order_number: 'WO-2026-0001',
      status: 'IN_PROGRESS' as const,
      createdAt: '2026-02-02T10:00:00.000Z',
      tasks: [
        {
          lineItems: [
            { quantity: 2, unitPrice: 50 },
          ],
        },
      ],
    },
  ],
  invoices: [],
  vehicles: [
    {
      id: 'veh-1',
      vin: 'WAUZZZ8V1KA123456',
      license_plate: 'W-1234AB',
      make: 'Audi',
      model: 'A3',
      year: 2020,
    },
  ],
}

describe('CustomerDetail', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    asMock(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  it('renders loading state when fetching customer', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText(/Loading customer details.../i)).toBeInTheDocument()
  })

  it('renders error state when fetch fails', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network timeout'),
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText(/Failed to load customer: Network timeout/i)).toBeInTheDocument()
  })

  it('renders not found when customer data is null', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText(/Customer not found/i)).toBeInTheDocument()
  })

  it('renders customer details, active orders, and vehicles tab', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: mockCustomer,
      isLoading: false,
      error: null,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument()
    expect(screen.getByText('+43 123 456789')).toBeInTheDocument()
    expect(screen.getByText(/SO-2026-0001/i)).toBeInTheDocument()
    expect(screen.getByText(/WO-2026-0001/i)).toBeInTheDocument()
  })
})
