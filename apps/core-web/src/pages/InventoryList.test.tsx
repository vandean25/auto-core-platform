import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryItem } from '@/api/types'
import * as inventoryApi from '@/api/inventory'
import * as locationsApi from '@/api/locations'
import { mockListLayout } from '@/components/data-table/data-table-infinite-test-utils'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../locales/de/common.json'
import deInventory from '../../../../locales/de/inventory.json'
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
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
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
