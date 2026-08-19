import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useDeletePurchaseInvoice } from './usePurchaseInvoices'
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

describe('useDeletePurchaseInvoice', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces the backend error message when delete is rejected', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ message: 'Invoice not found or no longer in DRAFT status' }, false),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    const { result } = renderHook(() => useDeletePurchaseInvoice(), { wrapper })

    await expect(result.current.mutateAsync('bill-1')).rejects.toThrow(
      'Invoice not found or no longer in DRAFT status',
    )
  })
})
