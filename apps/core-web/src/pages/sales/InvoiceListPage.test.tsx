import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoice } from '@/api/types'
import * as salesApi from '@/api/sales'
import { fetchWithAuth } from '@/api/client'
import { mockListLayout, settleVirtualizerTimers } from '@/components/data-table/data-table-infinite-test-utils'
import { createEchoSafeInvalidator } from '@/features/realtime/echo-safe-invalidator'
import { getQueryKeysToInvalidateForEntityType } from '@/features/realtime/dashboard-entity-map'
import deCommon from '../../../../../locales/de/common.json'
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
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
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


const jsonResponse = (body: unknown): Response => ({ ok: true, json: async () => body }) as Response
const BLOCK = 50

/** The invoice API of one test: cursor blocks (`offset:<n>` cursor) of `rows`, and the capped count. */
function serveInvoices(getRows: () => Invoice[]) {
  vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
    const parsed = new URL(String(url), 'http://acp.test')
    const rows = getRows()
    if (parsed.pathname.endsWith('/capped-count')) return jsonResponse({ count: rows.length, isCapped: false })
    if (parsed.searchParams.get('pagination') !== 'cursor') return jsonResponse(rows)
    const start = Number((parsed.searchParams.get('cursor') ?? 'offset:0').split(':')[1])
    const end = start + BLOCK
    return jsonResponse({
      data: rows.slice(start, end),
      meta: { nextCursor: end < rows.length ? `offset:${end}` : null, hasNextPage: end < rows.length, limit: BLOCK },
    })
  })
}

const manyInvoices = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    makeInvoice({ id: `inv-${index}`, invoice_number: `RE-2026-${String(index + 1).padStart(4, '0')}` }),
  )

/** Every list request (not the count, not a detail) the page sent, as parsed URLs. */
const listRequests = () =>
  vi
    .mocked(fetchWithAuth)
    .mock.calls.map((call) => new URL(String(call[0]), 'http://acp.test'))
    .filter((url) => url.pathname === '/api/sales/invoices')
const cursorRequests = () => listRequests().filter((url) => url.searchParams.get('pagination') === 'cursor')
const loadedNumbers = () =>
  Array.from(document.querySelectorAll('[data-table-row="true"]')).map((row) => /RE-2026-\d{4}/.exec(row.textContent ?? '')?.[0])

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

const dt = deCommon.dataTable

describe('InvoiceListPage', () => {
  // jsdom has no layout; the default route is an infinite (virtualized) list.
  let restoreLayout: () => void

  beforeEach(() => {
    restoreLayout = mockListLayout()
    mockNavigate.mockReset()
    mockUseAuth.mockReturnValue({ claims: { role: 'ADMIN' } })
    resetIntentPrefetchScheduler()
    asMock(salesApi.useInvoices).mockReturnValue({ data: [], isLoading: false })
    serveInvoices(() => [makeInvoice()])
  })

  afterEach(() => {
    cleanup()
    restoreLayout()
    resetIntentPrefetchScheduler()
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'connection')
    vi.clearAllMocks()
  })

  afterAll(settleVirtualizerTimers)

  it('renders the invoice list DataTable (AUT-311)', async () => {
    renderPage()

    expect(screen.getByRole('heading', { name: deSales.invoices.list.title })).toBeInTheDocument()
    expect(await screen.findByText('RE-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  // AUT-946 scenario 1: capped count appears before page one — skeleton must not outlive the count.
  it('AUT-946: WHEN the count is visible but page one is still pending THEN the table body does not keep skeleton rows', async () => {
    let releaseList: () => void = () => undefined
    const listBlocked = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const parsed = new URL(String(url), 'http://acp.test')
      if (parsed.pathname.endsWith('/capped-count')) return jsonResponse({ count: 1, isCapped: false })
      if (parsed.searchParams.get('pagination') === 'cursor') {
        await listBlocked
        return jsonResponse({
          data: [makeInvoice()],
          meta: { nextCursor: null, hasNextPage: false, limit: BLOCK },
        })
      }
      return jsonResponse([])
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('data-table-count')).toHaveTextContent('1 Treffer'))
    vi.useFakeTimers()
    try {
      act(() => vi.advanceTimersByTime(550))
    } finally {
      vi.useRealTimers()
    }
    expect(document.querySelector('tbody .animate-pulse')).toBeNull()
    releaseList()
    await screen.findByText('RE-2026-0001')
  })

  it('opens sales-order drafts on the edit route and finalized invoices on detail', async () => {
    serveInvoices(() => [
      makeInvoice({ id: 'inv-draft-so', status: 'DRAFT', sales_order_id: 'so-1', invoice_number: undefined }),
      makeInvoice({ id: 'inv-final', status: 'FINALIZED', invoice_number: 'RE-2026-0099' }),
    ])

    renderPage()

    fireEvent.click(await screen.findByText(deSales.shared.draftLabel.replace('{{id}}', 'inv-draf')))
    expect(mockNavigate).toHaveBeenCalledWith(APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', 'inv-draft-so'))

    fireEvent.click(screen.getByText('RE-2026-0099'))
    expect(mockNavigate).toHaveBeenCalledWith(APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', 'inv-final'))
  })

  // Regression: the page used to load every invoice and sort in the browser; each mode must ask only its own source.
  it.each([
    ['the default (newest first)', 'cursor', '', { sortField: 'date', sortDirection: 'desc' }],
    ['the number sort', 'cursor', '?sortField=invoice_number&sortDirection=asc', { sortField: 'invoice_number', sortDirection: 'asc' }],
    ['the date sort', 'cursor', '?sortField=date&sortDirection=asc', { sortField: 'date', sortDirection: 'asc' }],
    ['the customer sort', 'unpaged', '?sortField=customer&sortDirection=asc', undefined],
    ['the status sort', 'unpaged', '?sortField=status&sortDirection=desc', undefined],
    ['the total sort', 'unpaged', '?sortField=total_gross&sortDirection=asc', undefined],
  ] as const)('WHEN the list opens with %s THEN it uses the %s list source', async (_label, mode, search, expectedSort) => {
    renderPage(`/sales/invoices${search}`)

    if (mode === 'cursor') {
      await waitFor(() => expect(cursorRequests()).not.toHaveLength(0))
      const first = Object.fromEntries(cursorRequests()[0].searchParams)
      expect(first).toMatchObject({ pagination: 'cursor', limit: '50', ...expectedSort })
      expect(first).not.toHaveProperty('page')
      expect(asMock(salesApi.useInvoices)).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    } else {
      await waitFor(() => expect(asMock(salesApi.useInvoices)).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })))
      expect(listRequests()).toHaveLength(0)
    }
  })

  // Scenario 1: blocks continue from the cursor the server returned, with the same sort, so the order cannot reshuffle.
  it('WHEN invoices are sorted by number and the next block loads THEN it continues from the returned cursor without repeats', async () => {
    serveInvoices(() => manyInvoices(120))
    renderPage('/sales/invoices?sortField=invoice_number&sortDirection=asc')

    await screen.findByText('RE-2026-0001')
    fireEvent.click(await screen.findByRole('button', { name: dt.infinite.loadMore }))

    await waitFor(() => expect(cursorRequests()).toHaveLength(2))
    const [first, next] = cursorRequests().map((url) => Object.fromEntries(url.searchParams))
    expect(first).not.toHaveProperty('cursor')
    expect(next).toEqual({ ...first, cursor: 'offset:50' })
    await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false'))
    expect(new Set(loadedNumbers()).size).toBe(loadedNumbers().length)
  })

  // Scenario 2: the realtime event of an issued invoice marks the list outdated instead of re-requesting or reshuffling it.
  it('WHEN a new invoice is issued while the list is open THEN "Liste aktualisieren" appears and the visible rows stay put', async () => {
    let rows = [makeInvoice({ id: 'inv-old', invoice_number: 'RE-2026-0001' })]
    serveInvoices(() => rows)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage('/sales/invoices', client)
    await screen.findByText('RE-2026-0001')
    const requestsBefore = vi.mocked(fetchWithAuth).mock.calls.length

    rows = [makeInvoice({ id: 'inv-new', invoice_number: 'RE-2026-0002' }), ...rows]
    // The invalidation every realtime INVOICE event takes.
    act(() => {
      for (const queryKey of getQueryKeysToInvalidateForEntityType('INVOICE')) createEchoSafeInvalidator(client).invalidate(queryKey)
    })

    const refresh = await screen.findByRole('button', { name: dt.refreshList })
    expect(vi.mocked(fetchWithAuth).mock.calls).toHaveLength(requestsBefore)
    expect(loadedNumbers()).toEqual(['RE-2026-0001'])

    fireEvent.click(refresh)
    await waitFor(() => expect(loadedNumbers()).toEqual(['RE-2026-0002', 'RE-2026-0001']))
    expect(cursorRequests().at(-1)?.searchParams.has('cursor')).toBe(false)
  })

  it('filters the unpaged list by the search box across invoice number, customer and status', () => {
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [
        makeInvoice({ id: 'inv-ada', invoice_number: 'RE-2026-0001' }),
        makeInvoice({
          id: 'inv-alan',
          invoice_number: 'RE-2026-0002',
          customer: { ...customer, id: 'cust-2', first_name: 'Alan', last_name: 'Turing' },
        }),
      ],
      isLoading: false,
    })

    renderPage('/sales/invoices?sortField=customer&sortDirection=asc')
    fireEvent.change(screen.getByPlaceholderText(deSales.invoices.list.searchPlaceholder), { target: { value: 'turing' } })

    expect(screen.getByText('RE-2026-0002')).toBeInTheDocument()
    expect(screen.queryByText('RE-2026-0001')).not.toBeInTheDocument()
  })

  it('sorts the unpaged list by customer name', () => {
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [
        makeInvoice({ id: 'inv-b', invoice_number: 'RE-2026-0002', customer: { ...customer, last_name: 'Turing' } }),
        makeInvoice({ id: 'inv-a', invoice_number: 'RE-2026-0001', customer: { ...customer, last_name: 'Lovelace' } }),
      ],
      isLoading: false,
    })

    renderPage('/sales/invoices?sortField=customer&sortDirection=asc')

    expect(loadedNumbers()).toEqual(['RE-2026-0001', 'RE-2026-0002'])
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
    async ({ saveData, role }) => {
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
      await screen.findByText('RE-2026-0001')
      const row = container.querySelector('tr[data-table-row="true"]')
      expect(row).not.toBeNull()

      vi.useFakeTimers()
      fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
      vi.advanceTimersByTime(100)

      expect(prefetchSpy).toHaveBeenCalledTimes(0)
    },
  )
})
