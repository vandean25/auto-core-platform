import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  useAddPOItems,
  useCreatePO,
  useReceiveGoods,
  useUpdatePOItem,
  useDeletePOItem,
} from './purchase-orders'
import { fetchWithAuth } from './client'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('purchase orders api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('useAddPOItems', () => {
    it('sends wrapped items payload and returns updated PO', async () => {
      const mockUpdatedPO = { id: 'po-1', items: [] }
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(mockUpdatedPO),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)
      const { result } = renderHook(() => useAddPOItems(), { wrapper })

      const items = [
        {
          catalogItemId: 'cat-1',
          quantity: 2,
          unitCost: 15.5,
        },
      ]

      const response = await result.current.mutateAsync({
        orderId: 'po-1',
        items,
      })

      expect(response).toEqual(mockUpdatedPO)
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/purchase-orders/po-1/items',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        },
      )
    })

    it('surfaces backend validation / business logic error message', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Vendor Bosch does not support brand BMW' },
          false,
        ),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)
      const { result } = renderHook(() => useAddPOItems(), { wrapper })

      await expect(
        result.current.mutateAsync({
          orderId: 'po-1',
          items: [{ catalogItemId: 'cat-1', quantity: 1, unitCost: 10 }],
        }),
      ).rejects.toThrow('Vendor Bosch does not support brand BMW')
    })
  })

  describe('useCreatePO', () => {
    it('surfaces backend error message on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ message: 'Vendor not found' }, false),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)
      const { result } = renderHook(() => useCreatePO(), { wrapper })

      await expect(
        result.current.mutateAsync({
          vendorId: 'v-1',
          items: [],
        }),
      ).rejects.toThrow('Vendor not found')
    })
  })

  describe('useReceiveGoods', () => {
    it('surfaces backend error message on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Cannot receive more than ordered for item cat-1' },
          false,
        ),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)
      const { result } = renderHook(() => useReceiveGoods(), { wrapper })

      await expect(
        result.current.mutateAsync({
          orderId: 'po-1',
          items: [{ itemId: 'cat-1', quantity: 10 }],
        }),
      ).rejects.toThrow('Cannot receive more than ordered for item cat-1')
    })
  })

  describe('useUpdatePOItem', () => {
    it('surfaces backend error message on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Cannot reduce quantity below 5 already received' },
          false,
        ),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)
      const { result } = renderHook(() => useUpdatePOItem(), { wrapper })

      await expect(
        result.current.mutateAsync({
          orderId: 'po-1',
          itemId: 'item-1',
          updates: { quantity: 2 },
        }),
      ).rejects.toThrow('Cannot reduce quantity below 5 already received')
    })
  })

  describe('useDeletePOItem', () => {
    it('surfaces backend error message on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Cannot delete an item that has already been received' },
          false,
        ),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)
      const { result } = renderHook(() => useDeletePOItem(), { wrapper })

      await expect(
        result.current.mutateAsync({
          orderId: 'po-1',
          itemId: 'item-1',
        }),
      ).rejects.toThrow(
        'Cannot delete an item that has already been received',
      )
    })
  })
})
