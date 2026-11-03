import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoice } from '@/api/types'
import * as salesApi from '@/api/sales'
import { resetIntentPrefetchScheduler } from '@/lib/intent-prefetch'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import InvoiceListPage from './InvoiceListPage'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { deSales } from '@/test/de-sales'

const mockNavigate = vi.fn()
const mockUseAuth = vi.fn((): { claims: { role?: string } | null } => ({
  claims: { role: 'ADMIN' },
}))

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/sales')>()
  return {
    ...actual,
    useInvoices: vi.fn(),
  }
})
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const customer = {
  id: 'cust-1',
  type: 'PRIVATE' as const,
  first_name: 'Ada',
  last_name: 'Lovelace',
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    status: 'FINALIZED',
    customer_id: customer.id,
    customer,
    date: '2026-01-15T00:00:00.000Z',
    due_date: '2026-01-29T00:00:00.000Z',
    total_net: '100.00',
    total_tax: '19.00',
    total_gross: '119.00',
    items: [],
    invoice_number: 'RE-2026-0001',
    ...overrides,
  }
}

function renderPage(initialPath = '/sales/invoices', queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <MemoryRouter initialEntries={[initialPath]}>
          <InvoiceListPage />
        </MemoryRouter>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('InvoiceListPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockUseAuth.mockReturnValue({ claims: { role: 'ADMIN' } })
    resetIntentPrefetchScheduler()
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [makeInvoice()],
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    resetIntentPrefetchScheduler()
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'connection')
    vi.clearAllMocks()
  })

  it('renders the invoice list DataTable (AUT-311)', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: deSales.invoices.list.title })).toBeInTheDocument()
    expect(screen.getByText('RE-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('opens sales-order drafts on the edit route and finalized invoices on detail', () => {
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [
        makeInvoice({
          id: 'inv-draft-so',
          status: 'DRAFT',
          sales_order_id: 'so-1',
          invoice_number: undefined,
        }),
        makeInvoice({
          id: 'inv-final',
          status: 'FINALIZED',
          invoice_number: 'RE-2026-0099',
        }),
      ],
      isLoading: false,
    })

    renderPage()

    fireEvent.click(
      screen.getByText(deSales.shared.draftLabel.replace('{{id}}', 'inv-draf')),
    )
    expect(mockNavigate).toHaveBeenCalledWith(
      APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', 'inv-draft-so'),
    )

    fireEvent.click(screen.getByText('RE-2026-0099'))
    expect(mockNavigate).toHaveBeenCalledWith(
      APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', 'inv-final'),
    )
  })

  it('reorders rows when sortField and sortDirection change', () => {
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [
        makeInvoice({
          id: 'inv-newer',
          invoice_number: 'RE-2026-0002',
          date: '2026-02-01T00:00:00.000Z',
        }),
        makeInvoice({
          id: 'inv-older',
          invoice_number: 'RE-2026-0001',
          date: '2026-01-01T00:00:00.000Z',
        }),
      ],
      isLoading: false,
    })

    renderPage('/sales/invoices?sortField=date&sortDirection=asc')

    const bodyRows = document.querySelectorAll('[data-table-row="true"]')
    expect(bodyRows[0]).toHaveTextContent('RE-2026-0001')
    expect(bodyRows[1]).toHaveTextContent('RE-2026-0002')
  })

  it.each([
    {
      caseName: 'saveData is set',
      saveData: true,
      role: 'ADMIN',
    },
    {
      caseName: 'role cannot open invoice details (TECH)',
      saveData: false,
      role: 'TECH',
    },
  ])(
    'WHEN saveData is set or the role cannot open invoice details THEN no prefetch is sent ($caseName)',
    ({ saveData, role }) => {
      vi.useFakeTimers()
      Object.defineProperty(navigator, 'connection', {
        value: { saveData },
        configurable: true,
      })
      mockUseAuth.mockReturnValue({ claims: { role } })

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined)

      const { container } = renderPage('/sales/invoices', queryClient)
      const row = container.querySelector('tbody tr[data-table-row="true"]')
      expect(row).not.toBeNull()

      fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
      vi.advanceTimersByTime(100)

      expect(prefetchSpy).toHaveBeenCalledTimes(0)
    },
  )
})
