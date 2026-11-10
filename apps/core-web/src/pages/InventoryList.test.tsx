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
      { enabled: false },
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

      expect(asMock(inventoryApi.useInventory)).toHaveBeenLastCalledWith(expect.anything(), { enabled: false })
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
      { enabled: true },
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

describe('InventoryList bulk price change (AUT-886)', () => {
  const bulk = deInventory.bulk.adjustPrice
  const items: InventoryItem[] = ['1', '2', '3'].map((n) => ({ ...item, id: `item-${n}`, sku: `BRK-00${n}`, name: `Pad ${n}` }))
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

  beforeEach(() => {
    restoreLayout = mockListLayout()
    vi.clearAllMocks()
    authRole.current = 'ADMIN'
    asMock(inventoryApi.useInventory).mockReturnValue({ data: undefined, isLoading: false })
    asMock(inventoryApi.useInventoryCursorList).mockReturnValue(cursorListOf(items))
    asMock(locationsApi.useLocations).mockReturnValue({ data: [], isLoading: false })
  })
  afterEach(() => {
    cleanup()
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

  function submitPercent(dialog: HTMLElement, percent: string) {
    fireEvent.change(within(dialog).getByLabelText(bulk.percentLabel), { target: { value: percent } })
    fireEvent.click(within(dialog).getByRole('button', { name: bulk.submit }))
  }

  it('WHEN the bulk price action runs THEN only the selected IDs are sent to the server', async () => {
    fetchWithAuth.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? json(200, {})
        : json(200, { id: url.split('/').pop(), sku: 'X', name: 'Pad', brand_id: null, cost_price: 60, price: 100 }),
    )
    renderList()

    submitPercent(selectFirstTwoAndOpenDialog(), '10')

    await waitFor(() => expect(requests().filter((entry) => entry.startsWith('PATCH'))).toHaveLength(2))
    expect(new Set(requests())).toEqual(
      new Set(['GET /api/inventory/item-1', 'GET /api/inventory/item-2', 'PATCH /api/inventory/item-1', 'PATCH /api/inventory/item-2']),
    )
    const patch = fetchWithAuth.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toMatchObject({ retail_price: 110, cost_price: 60 })
  })

  it('WHEN the server answers 403 for every record THEN the dialog reports each part and the selection stays', async () => {
    fetchWithAuth.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? json(403, { statusCode: 403, message: 'Only OWNER or ADMIN can receive, adjust, or edit inventory items.' })
        : json(200, { id: url.split('/').pop(), sku: 'X', name: 'Pad', brand_id: null, cost_price: 60, price: 100 }),
    )
    renderList()

    submitPercent(selectFirstTwoAndOpenDialog(), '10')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`${deInventory.bulk.adjustPrice.result.replace('{{updated}}', '0').replace('{{total}}', '2')}`)
    expect(alert).toHaveTextContent('Keine Berechtigung: 2 Teile (BRK-001, BRK-002)')
    expect(alert).toHaveTextContent(bulk.forbiddenHint)
    expect(alert).not.toHaveTextContent('BRK-003')
    expect(screen.getByRole('toolbar', { hidden: true })).toHaveTextContent('2 ausgewählt')
  })

  // Review of 9c9b2aa: a retry after a partial failure used to apply the percentage again to parts that had succeeded.
  describe('result states', () => {
    const detail = (url: string) => ({ id: url.split('/').pop(), sku: 'X', name: 'Pad', brand_id: null, cost_price: 60, price: 100 })
    /** PATCH answers per part from `status`, which a test may change between submits (the cause was fixed). */
    function serverWith(status: Record<string, number>) {
      fetchWithAuth.mockImplementation((url: string, init?: RequestInit) =>
        init?.method === 'PATCH' ? json(status[url.split('/').pop() as string] ?? 200, {}) : json(200, detail(url)),
      )
    }
    const patched = () => requests().filter((entry) => entry.startsWith('PATCH'))

    it('WHEN every part is changed THEN the dialog closes, a toast reports the count and the selection is cleared', async () => {
      serverWith({})
      renderList()

      submitPercent(selectFirstTwoAndOpenDialog(), '10')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(toast.success).toHaveBeenCalledWith('2 Preise geändert')
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    })

    it('WHEN only some parts fail THEN only those are listed and the count says how many changed', async () => {
      serverWith({ 'item-2': 500 })
      renderList()

      submitPercent(selectFirstTwoAndOpenDialog(), '10')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('1 von 2 geändert.')
      expect(alert).toHaveTextContent('Fehlgeschlagen: 1 Teil (BRK-002)')
      expect(alert).not.toHaveTextContent('BRK-001')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('WHEN the user retries after a partial failure THEN only the failed parts are sent again and the percentage is not applied twice', async () => {
      const status: Record<string, number> = { 'item-2': 500 }
      serverWith(status)
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      submitPercent(dialog, '10')
      await screen.findByRole('alert')
      status['item-2'] = 200

      expect(within(dialog).getByLabelText(deInventory.bulk.adjustPrice.percentLabel)).toBeDisabled()
      fireEvent.click(within(dialog).getByRole('button', { name: bulk.retryFailed }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(patched().filter((entry) => entry.endsWith('item-1'))).toHaveLength(1)
      expect(patched().filter((entry) => entry.endsWith('item-2'))).toHaveLength(2)
      expect(toast.success).toHaveBeenCalledWith('2 Preise geändert')
    })

    it('WHEN the dialog is closed after a failure and opened again THEN it starts empty', async () => {
      serverWith({ 'item-2': 500 })
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      submitPercent(dialog, '10')
      await screen.findByRole('alert')

      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: bulk.action }))

      const reopened = screen.getByRole('dialog')
      expect(within(reopened).getByLabelText(bulk.percentLabel)).toHaveValue('')
      expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
    })
    // Review of 34925ea: closing and reopening used to target the whole selection again, including parts already changed.
    it('WHEN the dialog is closed after a partial failure and opened again THEN only the failed parts are selected and sent', async () => {
      const status: Record<string, number> = { 'item-2': 500 }
      serverWith(status)
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      submitPercent(dialog, '10')
      await screen.findByRole('alert')
      status['item-2'] = 200

      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByRole('toolbar')).toHaveTextContent('1 ausgewählt')
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: bulk.action }))
      const reopened = screen.getByRole('dialog')
      expect(within(reopened).getByLabelText(bulk.percentLabel)).toHaveValue('')
      expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
      submitPercent(reopened, '10')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(patched().filter((entry) => entry.endsWith('item-1'))).toHaveLength(1)
      expect(patched().filter((entry) => entry.endsWith('item-2'))).toHaveLength(2)
    })

    // Review of 34925ea: a partial result written into a dismissed dialog was never seen.
    it('WHEN the dialog is dismissed while the request runs THEN it stays open and shows the result', async () => {
      const releases: Array<() => void> = []
      fetchWithAuth.mockImplementation((url: string, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? new Promise<Response>((resolve) => {
              releases.push(() => resolve(new Response('{}', { status: 500 })))
            })
          : json(200, detail(url)),
      )
      renderList()
      const dialog = selectFirstTwoAndOpenDialog()
      submitPercent(dialog, '10')
      await waitFor(() => expect(releases).toHaveLength(2))

      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      releases.forEach((release) => release())

      expect(await screen.findByRole('alert')).toHaveTextContent('Fehlgeschlagen')
    })

    // Review of 34925ea (Kompakte Texte): 100 failures with one reason are one line, not 100.
    it('WHEN 100 parts fail for the same reason THEN the dialog shows one grouped line with the first SKUs', async () => {
      const many = Array.from({ length: 100 }, (_, index) => ({ ...item, id: `item-${index}`, sku: `BRK-${index}` }))
      asMock(inventoryApi.useInventoryCursorList).mockReturnValue(cursorListOf(many))
      fetchWithAuth.mockImplementation((url: string, init?: RequestInit) =>
        init?.method === 'PATCH' ? json(403, { statusCode: 403, message: 'forbidden' }) : json(200, detail(url)),
      )
      renderList()
      fireEvent.click(screen.getByRole('checkbox', { name: /geladenen Zeilen auswählen/ }))
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: bulk.action }))

      submitPercent(screen.getByRole('dialog'), '10')

      const alert = await screen.findByRole('alert')
      expect(within(alert).getAllByRole('listitem')).toHaveLength(1)
      expect(alert).toHaveTextContent('Keine Berechtigung: 100 Teile (BRK-0, BRK-1, BRK-2 und 97 weitere)')
    })
  })

  it('WHEN the role may not edit prices THEN no bulk price action is offered, in the bar or in Cmd+K', () => {
    authRole.current = 'SALES'
    renderList()

    fireEvent.click(screen.getAllByRole('checkbox', { name: deCommon.dataTable.selectRow })[0])

    expect(within(screen.getByRole('toolbar')).queryByRole('button', { name: bulk.action })).not.toBeInTheDocument()
    expect(getSelectionPaletteSection()).toBeNull()
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

  // Large data: select-all-loaded can reach 2,000 rows, but one action must not fire 4,000 requests.
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
