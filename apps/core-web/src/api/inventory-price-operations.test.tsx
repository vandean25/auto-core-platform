import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { fetchWithAuth } from './client'
import { inventoryKeys } from './inventory'
import {
  useExecuteGuardedPriceChanges,
  useFenceInventoryPriceOperation,
  type FrozenGuardedPriceIntent,
} from './inventory-price-operations'
import type { InventoryItem } from './types'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function makeItem(id: string, sku: string, price: number, revision = 1): InventoryItem {
  return {
    id,
    sku,
    name: `Part ${sku}`,
    brand: 'Bosch',
    price,
    status: 'IN_STOCK',
    quantity_available: 5,
    warehouse_location: 'A-1',
    revision,
  }
}

function makeIntent(id: string, sku: string, basisPrice: number, targetPrice: number, expectedRevision = 1): FrozenGuardedPriceIntent {
  return {
    key: `01900000-0000-7000-8000-00000000000${id.slice(-1)}`,
    itemId: id,
    sku,
    name: `Part ${sku}`,
    basisPrice,
    targetPrice,
    targetMinorUnits: Math.round(targetPrice * 100),
    expectedRevision,
    createdAt: 1_700_000_000_000,
  }
}

function createHarness(items: InventoryItem[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const cursorKey = inventoryKeys.cursorList({ sortField: 'sku', sortDirection: 'asc' })
  const offsetKey = inventoryKeys.list({ page: 1, pageSize: 10 })
  queryClient.setQueryData(cursorKey, {
    pages: [{ data: items, meta: { nextCursor: null, hasNextPage: false } }],
    pageParams: [undefined],
  })
  queryClient.setQueryData(offsetKey, {
    data: items,
    meta: { total: items.length, page: 1, limit: 10, pageCount: 1 },
  })
  for (const item of items) {
    queryClient.setQueryData(inventoryKeys.detail(item.id), { ...item, cost_price: item.price * 0.6 })
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, cursorKey, offsetKey, wrapper }
}

describe('inventory price operations cache sync (AUT-1030)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  // Regression: AUT-1030 — cursorList has staleTime: 'static' and does not refetch on invalidateQueries,
  // so applied guarded price changes must patch cached rows directly.
  it('WHEN a guarded price change is APPLIED THEN cursorList, offset list, and detail caches show the new price without refetching', async () => {
    const item1 = makeItem('item-1', 'BRK-001', 100, 3)
    const { queryClient, cursorKey, offsetKey, wrapper } = createHarness([item1])

    vi.mocked(fetchWithAuth).mockResolvedValueOnce(jsonResponse(200, { id: 'item-1', retail_price: 110, revision: 4 }))

    const { result } = renderHook(() => useExecuteGuardedPriceChanges(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync([makeIntent('item-1', 'BRK-001', 100, 110, 3)])
    })

    const cursorCache = queryClient.getQueryData<{ pages: Array<{ data: InventoryItem[] }> }>(cursorKey)
    expect(cursorCache?.pages[0].data[0].price).toBe(110)

    const offsetCache = queryClient.getQueryData<{ data: InventoryItem[] }>(offsetKey)
    expect(offsetCache?.data[0].price).toBe(110)

    const detailCache = queryClient.getQueryData<InventoryItem>(inventoryKeys.detail('item-1'))
    expect(detailCache?.price).toBe(110)
  })

  // Anti-criteria 2 & 3: conflict and pending/unresolved items must never take an applied or guessed price.
  it('WHEN a bulk run has APPLIED, CONFLICT, and PENDING outcomes THEN only APPLIED rows get the new price', async () => {
    const item1 = makeItem('item-1', 'BRK-001', 100, 1)
    const item2 = makeItem('item-2', 'BRK-002', 200, 1)
    const item3 = makeItem('item-3', 'BRK-003', 300, 1)
    const { queryClient, cursorKey, wrapper } = createHarness([item1, item2, item3])

    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      const target = String(url)
      if (init?.method === 'PATCH' && target.endsWith('/item-1')) {
        return jsonResponse(200, { id: 'item-1', retail_price: 110, revision: 2 })
      }
      if (init?.method === 'PATCH' && target.endsWith('/item-2')) {
        return jsonResponse(409, { code: 'INVENTORY_REVISION_CONFLICT' })
      }
      if (init?.method === 'PATCH' && target.endsWith('/item-3')) {
        return jsonResponse(503, { code: 'TEMPORARY' })
      }
      if (target.startsWith('/api/inventory/price-operations/')) {
        return jsonResponse(200, {
          key: 'k-3',
          itemId: 'item-3',
          sku: 'BRK-003',
          state: 'ACCEPTED',
          kind: 'BULK_PERCENT',
          expectedRevision: 1,
          retail_price: '330.00',
          basis_retail_price: '300.00',
          acceptedAt: new Date().toISOString(),
          finalAt: null,
          errorCode: null,
        })
      }
      return jsonResponse(404, {})
    })

    const { result } = renderHook(() => useExecuteGuardedPriceChanges(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync([
        makeIntent('item-1', 'BRK-001', 100, 110, 1),
        makeIntent('item-2', 'BRK-002', 200, 220, 1),
        makeIntent('item-3', 'BRK-003', 300, 330, 1),
      ])
    })

    const cursorCache = queryClient.getQueryData<{ pages: Array<{ data: InventoryItem[] }> }>(cursorKey)
    expect(cursorCache?.pages[0].data.map((row) => [row.id, row.price])).toEqual([
      ['item-1', 110],
      ['item-2', 200],
      ['item-3', 300],
    ])
  })

  it('WHEN fencing settles an operation as APPLIED THEN the cached row updates to the server retail_price, and FENCED leaves it unchanged', async () => {
    const item1 = makeItem('item-1', 'BRK-001', 100, 1)
    const item2 = makeItem('item-2', 'BRK-002', 200, 1)
    const { queryClient, cursorKey, wrapper } = createHarness([item1, item2])

    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          key: 'k-1',
          itemId: 'item-1',
          sku: 'BRK-001',
          state: 'APPLIED',
          kind: 'BULK_PERCENT',
          expectedRevision: 1,
          retail_price: '125.50',
          basis_retail_price: '100.00',
          acceptedAt: '2026-11-20T00:00:00.000Z',
          finalAt: '2026-11-20T00:00:01.000Z',
          errorCode: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          key: 'k-2',
          itemId: 'item-2',
          sku: 'BRK-002',
          state: 'FENCED',
          kind: 'BULK_PERCENT',
          expectedRevision: 1,
          retail_price: '250.00',
          basis_retail_price: '200.00',
          acceptedAt: '2026-11-20T00:00:00.000Z',
          finalAt: '2026-11-20T00:00:01.000Z',
          errorCode: null,
        }),
      )

    const { result } = renderHook(() => useFenceInventoryPriceOperation(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ key: 'k-1', itemId: 'item-1', retail_price: 125.5, expectedRevision: 1 })
      await result.current.mutateAsync({ key: 'k-2', itemId: 'item-2', retail_price: 250, expectedRevision: 1 })
    })

    const cursorCache = queryClient.getQueryData<{ pages: Array<{ data: InventoryItem[] }> }>(cursorKey)
    expect(cursorCache?.pages[0].data.map((row) => [row.id, row.price])).toEqual([
      ['item-1', 125.5],
      ['item-2', 200],
    ])
  })
})
