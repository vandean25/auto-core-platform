import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryItem } from '@/api/types'
import * as inventoryApi from '@/api/inventory'
import * as brandsApi from '@/api/brands'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import InventoryList from './InventoryList'

vi.mock('@/api/inventory')
vi.mock('@/api/brands')
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

describe('InventoryList row context Delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(inventoryApi.useInventory).mockReturnValue({
      data: { data: [item], meta: { total: 1, page: 1, limit: 10, pageCount: 1 } },
      isLoading: false,
    })
    asMock(brandsApi.useBrands).mockReturnValue({ data: [], isLoading: false })
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
})
