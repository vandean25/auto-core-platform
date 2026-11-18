import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryItem } from '@/api/types'
import * as inventoryApi from '@/api/inventory'
import * as locationsApi from '@/api/locations'
import { mockListLayout, settleVirtualizerTimers } from '@/components/data-table/data-table-infinite-test-utils'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../locales/de/common.json'
import deInventory from '../../../../locales/de/inventory.json'
import { getSelectionPaletteSection } from '@/features/actions/selection-palette-store'
import InventoryList from './InventoryList'

const partsList = deInventory.partsList

vi.mock('@/api/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/inventory')>()),
  useInventory: vi.fn(),
  useInventoryCursorList: vi.fn(),
}))
vi.mock('@/api/locations', () => ({
  useLocations: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const { authRole, fetchWithAuth } = vi.hoisted(() => ({ authRole: { current: 'ADMIN' }, fetchWithAuth: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: authRole.current } }),
}))
// Only the transport is replaced, so the real bulk hook decides which requests are sent.
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth,
}))
vi.mock('@/components/AddItemDialog', () => ({
  AddItemDialog: () => <button type="button">+ Item</button>,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const item: InventoryItem = {
  id: 'item-1',
  sku: 'BRK-001',
  name: 'Brake Pad',
  brand: 'Bosch',
  price: 49.9,
  status: 'IN_STOCK',
  quantity_available: 4,
  warehouse_location: 'A-1',
  revision: 0,
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

describe('InventoryList row actions', () => {
  // jsdom has no layout; the default route is an infinite (virtualized) list.
  let restoreLayout: () => void

  beforeEach(() => {
    restoreLayout = mockListLayout()
    vi.clearAllMocks()
    asMock(inventoryApi.useInventory).mockReturnValue({
      data: { data: [item], meta: { total: 1, page: 1, limit: 10, pageCount: 1 } },
      isLoading: false,
    })
    asMock(inventoryApi.useInventoryCursorList).mockReturnValue({
      rows: [item],
      tableProps: {
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        isError: false,
        onRetry: vi.fn(),
        hasUsableData: true,
        infinite: {
          queryKey: ['inventory', 'cursor-list', {}],
          hasNextPage: false,
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          fetchNextPage: vi.fn(),
          totalCount: { count: 1, isCapped: false },
        },
      },
    })
    asMock(locationsApi.useLocations).mockReturnValue({
      data: [
        { id: 'loc-1', name: 'A-1', code: 'A-1', type: 'warehouse' },
        { id: 'loc-2', name: 'Transit Bin', code: 'TRANSIT-1', type: 'staging_tote' },
      ],
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    restoreLayout()
  })

  afterAll(settleVirtualizerTimers)

  // AUT-946 scenario 2: capped count before rows — no lasting skeleton beside "N Treffer".
  it('AUT-946: WHEN the count is visible but rows are still pending THEN the table body does not keep skeleton rows', async () => {
    vi.useFakeTimers()
    try {
      asMock(inventoryApi.useInventoryCursorList).mockReturnValue({
        rows: [],
        tableProps: {
          isLoading: true,
          isFetching: true,
          isPlaceholderData: false,
          isError: false,
          onRetry: vi.fn(),
          hasUsableData: false,
          infinite: {
            queryKey: ['inventory', 'cursor-list', {}],
            hasNextPage: true,
            isFetchingNextPage: false,
            isFetchNextPageError: false,
            fetchNextPage: vi.fn(),
            totalCount: { count: 3, isCapped: false },
          },
        },
      })
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={queryClient}>
          <SavedViewsProvider userKey="test-user">
            <DashboardWidgetsProvider userKey="test-user">
              <MemoryRouter>
                <InventoryList />
              </MemoryRouter>
            </DashboardWidgetsProvider>
          </SavedViewsProvider>
        </QueryClientProvider>,
      )
      expect(screen.getByTestId('data-table-count')).toHaveTextContent('3 Treffer')
      act(() => vi.advanceTimersByTime(550))
      expect(document.querySelector('tbody .animate-pulse')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose Delete for catalog items', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter>
              <InventoryList />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    fireEvent.contextMenu(screen.getByText('BRK-001'))

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('filters inventory by storage location name and hides non-warehouse locations', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter>
              <InventoryList />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('combobox', { name: partsList.locationAria }))
    expect(screen.getByRole('option', { name: 'A-1' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Transit Bin' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'A-1' }))

    expect(asMock(inventoryApi.useInventory)).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'A-1' }),
      expect.objectContaining({ enabled: false }),
    )
    expect(asMock(inventoryApi.useInventoryCursorList)).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'A-1' }),
      true,
    )
  })

  it('renders the storage location column', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter>
              <InventoryList />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText(partsList.columns.storageLocation)).toBeInTheDocument()
    expect(screen.getByText('A-1')).toBeInTheDocument()
  })

  it('opens the part detail when a row is clicked', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter>
              <InventoryList />
              <LocationProbe />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByText('BRK-001'))

    expect(screen.getByTestId('location')).toHaveTextContent('/inventory/item-1/ledger?sku=BRK-001')
  })

  function renderAt(entry: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter initialEntries={[entry]}>
              <InventoryList />
              <LocationProbe />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )
  }

  // AUT-890: a cursor-supported sort (or none) scrolls without page buttons and keeps the offset query idle.
  it.each(['/inventory', '/inventory?sortField=price&sortDirection=desc'])(
    'WHEN %s is opened THEN the rows come from the infinite list without page controls',
    (entry) => {
      renderAt(entry)

      expect(asMock(inventoryApi.useInventory)).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false }),
      )
      expect(asMock(inventoryApi.useInventoryCursorList)).toHaveBeenLastCalledWith(expect.anything(), true)
      expect(screen.getByText('BRK-001')).toBeInTheDocument()
      expect(screen.getByText('1 Treffer')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: deCommon.dataTable.next })).not.toBeInTheDocument()
    },
  )

  // AUT-890 scenario 4: a sort the cursor API does not whitelist falls back to the working offset list.
  it('WHEN the URL sorts by a non-cursor field THEN the offset list is enabled and the cursor list idle', () => {
    renderAt('/inventory?sortField=status&sortDirection=asc')

    expect(asMock(inventoryApi.useInventory)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'status' }),
      expect.objectContaining({ enabled: true }),
    )
    expect(asMock(inventoryApi.useInventoryCursorList)).toHaveBeenLastCalledWith(expect.anything(), false)
    expect(screen.getByText('BRK-001')).toBeInTheDocument()
    expect(screen.queryByText('1 Treffer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: deCommon.dataTable.next })).toBeInTheDocument()
  })

  // AUT-890 scenario 3: the table's own reset to page one lost against the URL sync of useDataTableQuery on mount, so
  // the link kept "page=3" in the address bar (and the filter state) although the infinite list ignores pages.
  it('WHEN an old ?page=3 link is opened THEN page is dropped from the URL and search and sort are kept', async () => {
    renderAt('/inventory?page=3&search=bremse&sortField=name&sortDirection=desc')

    await waitFor(
      () => expect(screen.getByTestId('location')).toHaveTextContent('/inventory?search=bremse&sortField=name&sortDirection=desc'),
      { timeout: 3000 },
    )
    expect(asMock(inventoryApi.useInventoryCursorList)).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'bremse', sortField: 'name', sortDirection: 'desc' }),
      true,
    )
  })
})

describe('InventoryList bulk price change (AUT-886 / AUT-936)', () => {
  const bulk = deInventory.bulk.adjustPrice
  const items: InventoryItem[] = ['1', '2', '3'].map((n) => ({ ...item, id: `item-${n}`, sku: `BRK-00${n}`, name: `Pad ${n}` }))
  const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  let restoreLayout: () => void

  const cursorListOf = (rows: InventoryItem[]) => ({
    rows,
    tableProps: {
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      onRetry: vi.fn(),
      hasUsableData: true,
      infinite: {
        queryKey: ['inventory', 'cursor-list', {}],
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        fetchNextPage: vi.fn(),
        totalCount: { count: rows.length, isCapped: false },
      },
    },
  })

  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  const requests = () =>
    fetchWithAuth.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`)

  const emptyDiscovery = { data: [], meta: { limit: 50, hasNextPage: false, nextCursor: null } }

  beforeEach(() => {
    restoreLayout = mockListLayout()
    vi.clearAllMocks()
    window.localStorage.clear()
    authRole.current = 'ADMIN'
    asMock(inventoryApi.useInventory).mockReturnValue({ data: undefined, isLoading: false })
    asMock(inventoryApi.useInventoryCursorList).mockReturnValue(cursorListOf(items))
    asMock(locationsApi.useLocations).mockReturnValue({ data: [], isLoading: false })
    fetchWithAuth.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/inventory/price-operations')) {
        return json(200, emptyDiscovery)
      }
      return json(200, { id: String(url).split('/').pop(), sku: 'BRK-001', name: 'Pad', brand_id: null, cost_price: 60, price: 100, revision: 5 })
    })
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    restoreLayout()
  })
  afterAll(settleVirtualizerTimers)

  function renderList() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter>
              <InventoryList />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )
  }

  function selectFirstTwoAndOpenDialog() {
    const boxes = screen.getAllByRole('checkbox', { name: deCommon.dataTable.selectRow })
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1], { shiftKey: true })
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: bulk.action }))
    return screen.getByRole('dialog')
  }

  async function previewAndConfirm(dialog: HTMLElement, percent: string) {
    fireEvent.change(within(dialog).getByLabelText(bulk.percentLabel), { target: { value: percent } })
    fireEvent.click(within(dialog).getByRole('button', { name: bulk.preview }))
    const confirmBtn = await within(dialog).findByRole('button', { name: bulk.confirm })
    fireEvent.click(confirmBtn)
  }

  // Scenario 1: consent freezes intent
  it('consent freezes intent: WHEN the user confirms a preview THEN each selected item gets exactly one guarded PATCH with the frozen target, revision and key', async () => {
    fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/inventory/price-operations')) return json(200, emptyDiscovery)
      if (init?.method === 'PATCH') return json(200, {})
      const id = String(url).split('/').pop()
      return json(200, {
        id,
        sku: id === 'item-1' ? 'BRK-001' : 'BRK-002',
        name: 'Pad',
        brand_id: null,
        cost_price: 60,
        price: id === 'item-1' ? 100 : 200,
        revision: id === 'item-1' ? 7 : 12,
      })
    })
    renderList()

    await previewAndConfirm(selectFirstTwoAndOpenDialog(), '10')

    await waitFor(() => expect(requests().filter((entry) => entry.startsWith('PATCH'))).toHaveLength(2))
    const patchCalls = fetchWithAuth.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    expect(patchCalls).toHaveLength(2)

    const seenKeys = new Set<string>()
    for (const [url, init] of patchCalls) {
      const reqInit = init as RequestInit
      const headers = reqInit.headers as Record<string, string>
      expect(headers['Idempotency-Key']).toMatch(UUID_V7_RE)
      seenKeys.add(headers['Idempotency-Key'])
      const body = JSON.parse(reqInit.body as string) as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual(['expectedRevision', 'retail_price'])
      if (String(url).endsWith('item-1')) {
        expect(body).toEqual({ retail_price: 110, expectedRevision: 7 })
      } else {
        expect(body).toEqual({ retail_price: 220, expectedRevision: 12 })
      }
    }
    expect(seenKeys.size).toBe(2)
  })

  // Scenario 5: 403 per item
  it('403 per item: WHEN the server answers 403 for every record THEN the dialog reports each part and the selection stays', async () => {
    fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/inventory/price-operations')) return json(200, emptyDiscovery)
      if (init?.method === 'PATCH') {
        return json(403, { statusCode: 403, message: 'Only OWNER or ADMIN can receive, adjust, or edit inventory items.' })
      }
      const id = String(url).split('/').pop()
      return json(200, { id, sku: id === 'item-1' ? 'BRK-001' : 'BRK-002', name: 'Pad', brand_id: null, cost_price: 60, price: 100, revision: 5 })
    })
    renderList()

    await previewAndConfirm(selectFirstTwoAndOpenDialog(), '10')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('0 von 2 geändert.')
    expect(alert).toHaveTextContent('Keine Berechtigung: 2 Teile (BRK-001, BRK-002)')
    expect(alert).toHaveTextContent(bulk.forbiddenHint)
    expect(alert).not.toHaveTextContent('BRK-003')
    expect(screen.getByRole('toolbar', { hidden: true })).toHaveTextContent('2 ausgewählt')
  })

  describe('result states and retry', () => {
    const detail = (url: string) => {
      const id = String(url).split('/').pop()
      return { id, sku: id === 'item-1' ? 'BRK-001' : 'BRK-002', name: 'Pad', brand_id: null, cost_price: 60, price: 100, revision: 5 }
    }
    function serverWith(patchResponses: Record<string, { status: number; body?: unknown }>) {
      fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/inventory/price-operations')) return json(200, emptyDiscovery)
        if (init?.method === 'PATCH') {
          const id = String(url).split('/').pop() as string
          const entry = patchResponses[id] ?? { status: 200, body: {} }
          return json(entry.status, entry.body ?? {})
        }
        return json(200, detail(url))
      })
    }
    const patched = () => requests().filter((entry) => entry.startsWith('PATCH'))

    it('WHEN every part is changed THEN the dialog closes, a toast reports the count and the selection is cleared', async () => {
      serverWith({})
      renderList()

      await previewAndConfirm(selectFirstTwoAndOpenDialog(), '10')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(toast.success).toHaveBeenCalledWith('2 Preise geändert')
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    })

    // Scenario 2: retry only definite failures
    it('retry only definite failures: WHEN one item returns INVENTORY_REVISION_CONFLICT and another returns 403 THEN retry resends only the definite failure and conflict new preview keeps definite failure selected and listed', async () => {
      const responses: Record<string, { status: number; body?: unknown }> = {
        'item-1': { status: 409, body: { code: 'INVENTORY_REVISION_CONFLICT' } },
        'item-2': { status: 403, body: { statusCode: 403 } },
      }
      serverWith(responses)
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      await previewAndConfirm(dialog, '10')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(bulk.states.conflict)
      expect(alert).toHaveTextContent('Keine Berechtigung: 1 Teil (BRK-002)')
      expect(within(dialog).getByRole('button', { name: bulk.newPreview })).toBeInTheDocument()

      fireEvent.click(within(dialog).getByRole('button', { name: bulk.retryFailed }))
      await waitFor(() => expect(patched().filter((entry) => entry.endsWith('item-2'))).toHaveLength(2))
      expect(patched().filter((entry) => entry.endsWith('item-1'))).toHaveLength(1)

      responses['item-1'] = { status: 200, body: {} }
      fireEvent.click(within(dialog).getByRole('button', { name: bulk.newPreview }))
      fireEvent.click(await within(dialog).findByRole('button', { name: bulk.confirm }))

      const updatedAlert = await screen.findByRole('alert')
      expect(updatedAlert).toHaveTextContent('1 von 2 geändert.')
      expect(updatedAlert).toHaveTextContent('Keine Berechtigung: 1 Teil (BRK-002)')
      expect(screen.getByRole('toolbar', { hidden: true })).toHaveTextContent('1 ausgewählt')

      responses['item-2'] = { status: 200, body: {} }
      fireEvent.click(within(dialog).getByRole('button', { name: bulk.retryFailed }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it.each([
      {
        label: '409 OPERATION_UNRESOLVED',
        patchItem1: () => json(409, { code: 'OPERATION_UNRESOLVED' }),
      },
      {
        label: 'PATCH throws and follow-up GET is 404',
        patchItem1: () => Promise.reject(new Error('network lost')),
      },
    ])(
      'WHEN $label and journal row is 404 THEN row shows Outcome unavailable with no retry of that key',
      async ({ patchItem1 }) => {
        fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
          if (String(url).startsWith('/api/inventory/price-operations/')) return json(404, { statusCode: 404 })
          if (String(url).startsWith('/api/inventory/price-operations')) return json(200, emptyDiscovery)
          if (init?.method === 'PATCH') {
            return String(url).endsWith('item-1') ? patchItem1() : json(403, { statusCode: 403 })
          }
          return json(200, detail(url))
        })
        renderList()
        const dialog = selectFirstTwoAndOpenDialog()
        await previewAndConfirm(dialog, '10')

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(bulk.states.outcomeUnavailable)
        expect(alert).not.toHaveTextContent(bulk.states.pending)
        expect(alert).not.toHaveTextContent(bulk.states.unresolved)

        fireEvent.click(within(dialog).getByRole('button', { name: bulk.retryFailed }))
        await waitFor(() => expect(patched().filter((entry) => entry.endsWith('item-2'))).toHaveLength(2))
        expect(patched().filter((entry) => entry.endsWith('item-1'))).toHaveLength(1)
      },
    )

    it('WHEN the dialog is closed after a failure and opened again THEN it starts empty and narrows selection', async () => {
      const responses: Record<string, { status: number; body?: unknown }> = { 'item-2': { status: 404 } }
      serverWith(responses)
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      await previewAndConfirm(dialog, '10')
      await screen.findByRole('alert')
      responses['item-2'] = { status: 200 }

      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByRole('toolbar')).toHaveTextContent('1 ausgewählt')
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: bulk.action }))

      const reopened = screen.getByRole('dialog')
      expect(within(reopened).getByLabelText(bulk.percentLabel)).toHaveValue('')
      expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
      await previewAndConfirm(reopened, '10')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(patched().filter((entry) => entry.endsWith('item-1'))).toHaveLength(1)
      expect(patched().filter((entry) => entry.endsWith('item-2'))).toHaveLength(2)
    })

    it('WHEN the dialog is dismissed while the request runs THEN it stays open and shows the result', async () => {
      const releases: Array<() => void> = []
      fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/inventory/price-operations')) return json(200, emptyDiscovery)
        if (init?.method === 'PATCH') {
          return new Promise<Response>((resolve) => {
            releases.push(() => resolve(new Response('{}', { status: 400 })))
          })
        }
        return json(200, detail(url))
      })
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      await previewAndConfirm(dialog, '10')
      await waitFor(() => expect(releases).toHaveLength(2))

      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      releases.forEach((release) => release())

      expect(await screen.findByRole('alert')).toHaveTextContent('Fehlgeschlagen')
    })

    it('WHEN 100 parts fail for the same reason THEN the dialog shows one grouped line with the first SKUs', async () => {
      const many = Array.from({ length: 100 }, (_, index) => ({ ...item, id: `item-${index}`, sku: `BRK-${index}` }))
      asMock(inventoryApi.useInventoryCursorList).mockReturnValue(cursorListOf(many))
      fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/inventory/price-operations')) return json(200, emptyDiscovery)
        if (init?.method === 'PATCH') return json(403, { statusCode: 403 })
        const id = String(url).split('/').pop()
        const idx = Number(id?.replace('item-', ''))
        return json(200, { id, sku: `BRK-${idx}`, name: 'Pad', brand_id: null, cost_price: 60, price: 100, revision: 1 })
      })
      renderList()
      fireEvent.click(screen.getByRole('checkbox', { name: /geladenen Zeilen auswählen/ }))
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: bulk.action }))

      await previewAndConfirm(screen.getByRole('dialog'), '10')

      const alert = await screen.findByRole('alert')
      expect(within(alert).getAllByRole('listitem')).toHaveLength(1)
      expect(alert).toHaveTextContent('Keine Berechtigung: 100 Teile (BRK-0, BRK-1, BRK-2 und 97 weitere)')
    })
  })

  // Scenario 3: lost response recovered via discovery
  it('lost response recovered via discovery: WHEN the response is lost and the page reloads THEN discovery shows the operation as Pending or Unresolved, not as failed', async () => {
    const recentAcceptedAt = new Date(Date.now() - 30_000).toISOString()
    const staleAcceptedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    fetchWithAuth.mockImplementation((url: string) => {
      if (String(url) === '/api/inventory/price-operations') {
        return json(200, {
          data: [
            {
              key: '01930000-0000-7000-8000-000000000001',
              itemId: 'item-1',
              sku: 'BRK-001',
              state: 'ACCEPTED',
              kind: 'RETAIL_PRICE',
              expectedRevision: 5,
              retail_price: '54.89',
              basis_retail_price: '49.90',
              acceptedAt: recentAcceptedAt,
              finalAt: null,
              errorCode: null,
            },
            {
              key: '01930000-0000-7000-8000-000000000002',
              itemId: 'item-2',
              sku: 'BRK-002',
              state: 'ACCEPTED',
              kind: 'RETAIL_PRICE',
              expectedRevision: 6,
              retail_price: '60.00',
              basis_retail_price: '50.00',
              acceptedAt: staleAcceptedAt,
              finalAt: null,
              errorCode: null,
            },
          ],
          meta: { limit: 50, hasNextPage: false, nextCursor: null },
        })
      }
      return json(200, emptyDiscovery)
    })

    renderList()

    const panel = await screen.findByRole('region', { name: bulk.discovery.panelHeading })
    expect(panel).toHaveTextContent(bulk.states.pending)
    expect(panel).toHaveTextContent(bulk.states.unresolved)
    expect(panel).not.toHaveTextContent(bulk.reasonFailed)
  })

  // Scenario 4: user fence
  it('user fence: WHEN the user marks an Unresolved item as not applied THEN the fence is called and the state becomes Not applied', async () => {
    const staleAcceptedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    const opKey = '01930000-0000-7000-8000-000000000009'
    let fenced = false
    fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === `/api/inventory/price-operations/${opKey}/fence` && init?.method === 'POST') {
        fenced = true
        return json(200, {
          key: opKey,
          itemId: 'item-2',
          sku: 'BRK-002',
          state: 'FENCED',
          kind: 'RETAIL_PRICE',
          expectedRevision: 6,
          retail_price: '60.00',
          basis_retail_price: '50.00',
          acceptedAt: staleAcceptedAt,
          finalAt: new Date().toISOString(),
          errorCode: null,
        })
      }
      if (String(url) === '/api/inventory/price-operations') {
        return json(200, {
          data: [
            {
              key: opKey,
              itemId: 'item-2',
              sku: 'BRK-002',
              state: fenced ? 'FENCED' : 'ACCEPTED',
              kind: 'RETAIL_PRICE',
              expectedRevision: 6,
              retail_price: '60.00',
              basis_retail_price: '50.00',
              acceptedAt: staleAcceptedAt,
              finalAt: fenced ? new Date().toISOString() : null,
              errorCode: null,
            },
          ],
          meta: { limit: 50, hasNextPage: false, nextCursor: null },
        })
      }
      return json(200, emptyDiscovery)
    })

    renderList()

    const fenceButton = await screen.findByRole('button', { name: bulk.markNotApplied })
    fireEvent.click(fenceButton)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/inventory/price-operations/${opKey}/fence`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ itemId: 'item-2', retail_price: 60, expectedRevision: 6 }),
        }),
      )
    })
    expect(await screen.findByText(bulk.states.notApplied)).toBeInTheDocument()
  })

  it('WHEN the role may not edit prices THEN no bulk price action or discovery is offered', () => {
    authRole.current = 'SALES'
    renderList()

    fireEvent.click(screen.getAllByRole('checkbox', { name: deCommon.dataTable.selectRow })[0])

    expect(within(screen.getByRole('toolbar')).queryByRole('button', { name: bulk.action })).not.toBeInTheDocument()
    expect(getSelectionPaletteSection()).toBeNull()
    expect(requests().filter((entry) => entry.includes('price-operations'))).toHaveLength(0)
  })

  it('WHEN rows are selected THEN the same registry action is published for Cmd+K and opens the dialog', () => {
    renderList()
    fireEvent.click(screen.getAllByRole('checkbox', { name: deCommon.dataTable.selectRow })[0])

    const action = getSelectionPaletteSection()?.items[0]
    expect(action).toMatchObject({ id: 'inventoryItem.bulkAdjustPrice', label: bulk.action })
    expect(screen.getByRole('toolbar').querySelector('[data-action-id="inventoryItem.bulkAdjustPrice"]')).not.toBeNull()
    act(() => action?.onSelect())

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('WHEN more than 100 parts are selected THEN the bar shows the limit instead of the action, also in Cmd+K', () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ ...item, id: `item-${index}`, sku: `BRK-${index}` }))
    asMock(inventoryApi.useInventoryCursorList).mockReturnValue(cursorListOf(many))
    renderList()

    fireEvent.click(screen.getByRole('checkbox', { name: /geladenen Zeilen auswählen/ }))

    const bar = screen.getByRole('toolbar')
    expect(bar).toHaveTextContent('101 ausgewählt')
    expect(bar).toHaveTextContent('Höchstens 100 Teile pro Aktion.')
    expect(within(bar).queryByRole('button', { name: bulk.action })).not.toBeInTheDocument()
    expect(getSelectionPaletteSection()).toBeNull()
  })

  it('WHEN the selection is cleared THEN nothing is published to Cmd+K any more', () => {
    renderList()
    fireEvent.click(screen.getAllByRole('checkbox', { name: deCommon.dataTable.selectRow })[0])
    expect(getSelectionPaletteSection()).not.toBeNull()

    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: deCommon.dataTable.actionBar.clear }))

    expect(getSelectionPaletteSection()).toBeNull()
  })
})
