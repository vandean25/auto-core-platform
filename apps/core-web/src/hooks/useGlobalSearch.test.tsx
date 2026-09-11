import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalSearch } from './useGlobalSearch'
import * as clientApi from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty lists when search term is empty', () => {
    const { result } = renderHook(() => useGlobalSearch(''), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toEqual({
      inventory: [],
      customers: [],
      vehicles: [],
      orders: [],
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('debounces and queries inventory, workshop search, and workshop orders in parallel', async () => {
    const mockFetch = vi.mocked(clientApi.fetchWithAuth)
    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/inventory')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'item-1',
                sku: 'BRK-001',
                name: 'Brake Pad',
                brand: 'Bosch',
                price: 49.9,
                quantity_available: 4,
              },
            ],
            meta: { total: 1 },
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/workshop/search')) {
        return new Response(
          JSON.stringify({
            data: {
              customers: [
                {
                  id: 'cust-1',
                  first_name: 'Max',
                  last_name: 'Mustermann',
                  type: 'PRIVATE',
                  vehicles: [],
                },
              ],
              vehicles: [
                {
                  id: 'veh-1',
                  make: 'Audi',
                  model: 'A4',
                  year: 2020,
                  plate: 'W-12345AB',
                  customer: null,
                },
              ],
            },
            meta: { total: 2 },
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/workshop/orders')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'wo-1',
                order_number: 'WO-2026-0004',
                status: 'IN_PROGRESS',
                customer: { first_name: 'Max', last_name: 'Mustermann' },
                vehicle: { make: 'Audi', model: 'A4', year: 2020, plate: 'W-12345AB' },
              },
            ],
            meta: { total: 1 },
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    })

    const { result, rerender } = renderHook(({ term }) => useGlobalSearch(term), {
      initialProps: { term: 'Mustermann' },
      wrapper: createWrapper(),
    })

    // Before debounce fires: debouncing is treated as pending, returning empty results
    expect(result.current.isFetching).toBe(true)
    expect(result.current.data.customers).toHaveLength(0)
    expect(mockFetch).not.toHaveBeenCalled()

    await waitFor(
      () => {
        expect(result.current.data.customers).toHaveLength(1)
        expect(result.current.data.vehicles).toHaveLength(1)
        expect(result.current.data.orders).toHaveLength(1)
        expect(result.current.data.inventory).toHaveLength(1)
      },
      { timeout: 2000 },
    )

    expect(result.current.data.customers[0].first_name).toBe('Max')
    expect(result.current.data.vehicles[0].plate).toBe('W-12345AB')
    expect(result.current.data.orders[0].order_number).toBe('WO-2026-0004')

    // When search term changes, immediately clears previous results and sets isFetching: true
    rerender({ term: 'Audi' })
    expect(result.current.isFetching).toBe(true)
    expect(result.current.data.customers).toHaveLength(0)
    expect(result.current.data.vehicles).toHaveLength(0)

    await waitFor(
      () => {
        expect(result.current.data.vehicles).toHaveLength(1)
      },
      { timeout: 2000 },
    )

    // Clearing the search also treats the debounce window as pending
    rerender({ term: '' })
    expect(result.current.isFetching).toBe(true)
    expect(result.current.data.customers).toHaveLength(0)
    expect(result.current.data.vehicles).toHaveLength(0)
  })
})
