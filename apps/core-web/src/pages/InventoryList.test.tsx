import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryItem } from '@/api/types'
import * as inventoryApi from '@/api/inventory'
import * as locationsApi from '@/api/locations'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import InventoryList from './InventoryList'

vi.mock('@/api/inventory')
vi.mock('@/api/locations', () => ({
  useLocations: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(inventoryApi.useInventory).mockReturnValue({
      data: { data: [item], meta: { total: 1, page: 1, limit: 10, pageCount: 1 } },
      isLoading: false,
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

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: 'A-1' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Transit Bin' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'A-1' }))

    expect(asMock(inventoryApi.useInventory)).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'A-1' }),
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

    expect(screen.getByText('Storage Location')).toBeInTheDocument()
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
})
