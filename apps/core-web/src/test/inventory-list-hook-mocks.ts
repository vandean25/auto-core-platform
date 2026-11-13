import type * as inventoryApi from '@/api/inventory'
import type * as locationsApi from '@/api/locations'
import type { InventoryItem } from '@/api/types'
import { vi } from 'vitest'

const defaultItem: InventoryItem = {
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

type MockFn = ReturnType<typeof vi.fn>

/** Offset + cursor hook stubs so InventoryList mounts under P4 without network. */
export function mockInventoryListHooks(
  asMock: <T extends (...args: never[]) => unknown>(fn: T) => MockFn,
  inventory: typeof inventoryApi,
  locations: typeof locationsApi,
  item: InventoryItem = defaultItem,
) {
  asMock(inventory.useInventory).mockReturnValue({
    data: { data: [item], meta: { total: 1, page: 1, limit: 10, pageCount: 1 } },
    isLoading: false,
  })
  asMock(inventory.useInventoryCursorList).mockReturnValue({
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
  asMock(locations.useLocations).mockReturnValue({
    data: [{ id: 'loc-1', name: 'A-1', code: 'A-1', type: 'warehouse' }],
    isLoading: false,
  })
  asMock(inventory.useCreateInventoryItem).mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  })
}
