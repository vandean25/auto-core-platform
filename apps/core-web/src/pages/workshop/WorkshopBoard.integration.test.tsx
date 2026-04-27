import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopBoard from './WorkshopBoard'
import { fetchWithAuth } from '@/api/client'

vi.mock('@/api/client', () => ({
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

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('WorkshopBoard integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/workshop/resources') {
        return jsonResponse({
          mechanics: [
            { id: 'mech-1', name: 'EmployeeMech', role: 'MECHANIC', isActive: true, sortOrder: 1 },
            { id: 'mech-2', name: 'Demo Mechanic A', role: 'MECHANIC', isActive: true, sortOrder: 2 },
          ],
          bays: [],
        })
      }

      if (url === '/api/workshop/board/active') {
        return jsonResponse({
          data: [
            {
              id: 'order-1',
              orderNumber: 'WO-2026-0001',
              status: 'INTAKE',
              customer: {
                id: 'customer-1',
                type: 'PRIVATE',
                firstName: 'Max',
                lastName: 'Mustermann',
                companyName: null,
              },
              vehicle: {
                id: 'vehicle-1',
                make: 'Volkswagen',
                model: 'Golf VII',
                year: 2018,
                plate: 'W-12345AB',
              },
              mechanicId: null,
              bayId: null,
              stagingLocationId: null,
              partsStatus: 'WAITING',
              tasks: [],
              createdAt: '2026-04-27T00:00:00.000Z',
              updatedAt: '2026-04-27T00:00:00.000Z',
            },
          ],
        })
      }

      if (url === '/api/workshop/board/assign' && init?.method === 'PATCH') {
        return jsonResponse({
          id: 'order-1',
          orderNumber: 'WO-2026-0001',
          status: 'INTAKE',
          mechanicId: 'mech-2',
          bayId: null,
          stagingLocationId: null,
          updatedAt: '2026-04-27T00:00:01.000Z',
        })
      }

      return jsonResponse({ message: `Unhandled request: ${url}` }, false, 500)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('sends non-null mechanicId to /board/assign when quick-assigning a mechanic', async () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkshopBoard />
      </QueryClientProvider>,
    )

    const assignButton = await screen.findByTestId('assign-mechanic-mech-2')
    fireEvent.click(assignButton)

    await waitFor(() => {
      const assignCall = vi
        .mocked(fetchWithAuth)
        .mock
        .calls
        .find(([input, init]) => input === '/api/workshop/board/assign' && init?.method === 'PATCH')

      expect(assignCall).toBeDefined()
      const requestBody = JSON.parse(String(assignCall?.[1]?.body))
      expect(requestBody).toEqual({
        orderId: 'order-1',
        mechanicId: 'mech-2',
      })
      expect(requestBody.mechanicId).not.toBeNull()
    })
  })
})

