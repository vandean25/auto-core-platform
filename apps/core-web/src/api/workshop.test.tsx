import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCreateWorkshopOrder, useWorkshopPickList } from './workshop'
import { fetchWithAuth } from './client'
import type { WorkshopOrder } from './types'
import type { ReactNode } from 'react'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function createWorkshopOrder(overrides: Partial<WorkshopOrder> = {}): WorkshopOrder {
  return {
    id: overrides.id ?? 'order-1',
    order_number: overrides.order_number ?? 'WO-2026-0001',
    status: overrides.status ?? 'INTAKE',
    customer_id: 'customer-1',
    customer: {
      id: 'customer-1',
      type: 'PRIVATE',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
    },
    vehicle_id: 'vehicle-1',
    vehicle: {
      id: 'vehicle-1',
      make: 'Audi',
      model: 'A4',
      year: 2024,
    },
    odometer: 1000,
    fuel_level: 0.5,
    createdAt: '2026-04-17T00:00:00.000Z',
    tasks: [
      {
        id: 'task-1',
        title: 'Inspect',
        status: 'IN_PROGRESS',
        done: false,
        lineItems: [
          {
            id: 'line-1',
            type: 'PART',
            itemNo: 'PART-1',
            description: 'Part 1',
            qty: 1,
            unitPrice: 10,
          },
        ],
      },
    ],
    ...overrides,
  }
}

function createJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('useWorkshopPickList', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads all backend pages before applying pick eligibility filters', async () => {
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(createJsonResponse({
        data: [createWorkshopOrder({
          id: 'scheduled-order',
          status: 'SCHEDULED',
          tasks: [],
        })],
        meta: {
          total: 101,
          page: 1,
          pageSize: 100,
          pageCount: 2,
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        data: [createWorkshopOrder({
          id: 'eligible-order',
          order_number: 'WO-2026-0101',
        })],
        meta: {
          total: 101,
          page: 2,
          pageSize: 100,
          pageCount: 2,
        },
      }))

    const queryClient = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useWorkshopPickList({ page: 1, pageSize: 25, filters: [] }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(fetchWithAuth).toHaveBeenCalledTimes(2)
    expect(result.current.data?.data.map((order) => order.id)).toEqual(['eligible-order'])
    expect(result.current.data?.meta.total).toBe(1)
  })

  it('surfaces backend error messages when creating workshop orders', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ message: 'Finance settings update failed' }, false, 500),
    )

    const queryClient = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useCreateWorkshopOrder(), { wrapper })

    await expect(result.current.mutateAsync({
      customerId: 'customer-1',
      vehicleId: 'vehicle-1',
      odometer: 0,
      fuelLevel: 50,
    })).rejects.toMatchObject({
      message: 'Finance settings update failed',
      status: 500,
    })
  })
})
